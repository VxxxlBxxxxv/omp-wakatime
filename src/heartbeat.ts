import { execFile } from "node:child_process";
import * as path from "node:path";
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from "node:child_process";
import type { Dependencies } from "./dependencies.js";
import type { HeartbeatRequest } from "./types.js";
import { logger } from "./logger.js";
import { hasApiKey, isDebugEnabled } from "./options.js";
import { shouldSendHeartbeat, updateLastHeartbeat } from "./state.js";

export const WAKATIME_CLI_TIMEOUT_MS = 30_000;

type ExecFileCallback = (error: ExecFileException | null, stdout: string, stderr: string) => void;
type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
  callback: ExecFileCallback,
) => void;

type HeartbeatSenderOptions = {
  dependencies: Pick<Dependencies, "getCliLocation" | "checkAndInstallCli" | "isCliInstalled">;
  plugin: string;
  execFile?: ExecFileFn;
};

type QueuedHeartbeat = {
  cliPath: string;
  args: string[];
  request: HeartbeatRequest;
};

export function buildHeartbeatArgs(plugin: string, request: HeartbeatRequest, verbose = false): string[] {
  const args = [
    "--entity", request.entity,
    "--entity-type", "file",
    "--plugin", plugin,
    "--sync-ai-disabled",
  ];

  if (verbose) {
    args.push("--verbose");
  }

  if (request.projectFolder) {
    args.push("--project-folder", request.projectFolder);
  }

  if (request.type === "session") {
    args.push("--is-unsaved-entity");
  }

  if (request.type === "file" && request.isWrite) {
    args.push("--write");
  }

  if (request.type === "file" && typeof request.lineChanges === "number" && request.lineChanges !== 0) {
    args.push("--category", "ai coding", "--ai-line-changes", String(request.lineChanges));
    return args;
  }

  args.push("--category", request.category || "coding");
  return args;
}

export class HeartbeatSender {
  private readonly dependencies: HeartbeatSenderOptions["dependencies"];
  private readonly plugin: string;
  private readonly execFile: ExecFileFn;
  private readonly queue: QueuedHeartbeat[] = [];
  private readonly sessionHeartbeatsInFlight = new Set<string>();
  private readonly verbose = isDebugEnabled();
  private processing = false;
  private initialized = false;

  constructor(options: HeartbeatSenderOptions) {
    this.dependencies = options.dependencies;
    this.plugin = options.plugin;
    this.execFile = options.execFile || execFile;
  }

  async init(): Promise<boolean> {
    if (!hasApiKey()) {
      // Guide requirement: verify api key at initialization. A headless runtime
      // cannot prompt, so surface one actionable error instead of silent per-heartbeat failures.
      logger.error(
        "WakaTime API key not found — heartbeats will fail. "
        + "Add it to ~/.wakatime.cfg ([settings] api_key=YOUR_KEY, key from https://wakatime.com/api-key) "
        + "or set the WAKATIME_API_KEY environment variable.",
      );
    }

    try {
      await this.dependencies.checkAndInstallCli();
      this.initialized = true;
      return true;
    } catch (error) {
      logger.warn("wakatime-cli initialization failed", { error: String(error) });
      return false;
    }
  }

  track(request: HeartbeatRequest): void {
    if (!this.initialized && !this.dependencies.isCliInstalled()) {
      logger.debug("Skipping heartbeat before wakatime-cli initialization", { entity: path.basename(request.entity) });
      return;
    }

    if (request.type === "session" && !this.shouldQueueSession(request)) return;

    const cliPath = this.dependencies.getCliLocation();
    this.queue.push({
      cliPath,
      args: buildHeartbeatArgs(this.plugin, request, this.verbose),
      request,
    });

    void this.processQueue();
  }

  async trackForce(request: HeartbeatRequest): Promise<void> {
    const cliPath = this.dependencies.getCliLocation();
    await this.execute({
      cliPath,
      args: buildHeartbeatArgs(this.plugin, request, this.verbose),
      request,
    });
  }

  private shouldQueueSession(request: Extract<HeartbeatRequest, { type: "session" }>): boolean {
    if (!shouldSendHeartbeat(request.stateKey)) return false;
    if (this.sessionHeartbeatsInFlight.has(request.stateKey)) return false;
    this.sessionHeartbeatsInFlight.add(request.stateKey);
    return true;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) await this.execute(next);
      }
    } finally {
      this.processing = false;
    }
  }

  private async execute(heartbeat: QueuedHeartbeat): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const execOptions: ExecFileOptionsWithStringEncoding = {
      encoding: "utf8",
      windowsHide: true,
      timeout: WAKATIME_CLI_TIMEOUT_MS,
      killSignal: "SIGKILL",
    };

    this.execFile(heartbeat.cliPath, heartbeat.args, execOptions, (error, stdout, stderr) => {
      if (heartbeat.request.type === "session") {
        this.sessionHeartbeatsInFlight.delete(heartbeat.request.stateKey);
      }

      if (error) {
        logger.warn("Heartbeat failed", { entity: path.basename(heartbeat.request.entity), error: stderr || error.message });
        resolve();
        return;
      }

      if (stdout.trim()) logger.debug("wakatime-cli stdout", { stdout: stdout.trim() });
      if (stderr.trim()) logger.warn("wakatime-cli stderr", { stderr: stderr.trim() });

      if (heartbeat.request.type === "session") {
        updateLastHeartbeat(heartbeat.request.stateKey);
      }

      resolve();
    });

    return promise;
  }
}

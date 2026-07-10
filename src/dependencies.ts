import AdmZip from "adm-zip";
import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ExecFileException, ExecFileOptionsWithStringEncoding } from "node:child_process";
import type { IncomingMessage } from "node:http";
import { getCliStatePath, getWakatimeResourcesDir } from "./paths.js";
import { isWindows } from "./utils.js";
import { logger } from "./logger.js";

type CliState = {
  lastChecked?: number;
  version?: string;
};

type ReleaseResponse = {
  tag_name?: string;
};

const GITHUB_RELEASES_URL = "https://api.github.com/repos/wakatime/wakatime-cli/releases/latest";
const GITHUB_DOWNLOAD_URL = "https://github.com/wakatime/wakatime-cli/releases/latest/download";
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class Dependencies {
  private readonly resourcesLocation = getWakatimeResourcesDir();
  private readonly stateFile = getCliStatePath();
  private cliLocation?: string;
  private globalCliLocation?: string;

  getCliLocation(): string {
    if (this.cliLocation) return this.cliLocation;

    const globalLocation = this.getCliLocationGlobal();
    if (globalLocation) {
      this.cliLocation = globalLocation;
      return globalLocation;
    }

    this.cliLocation = path.join(this.resourcesLocation, `wakatime-cli${isWindows() ? ".exe" : ""}`);
    return this.cliLocation;
  }

  getCliLocationGlobal(): string | undefined {
    if (this.globalCliLocation) return this.globalCliLocation;

    const binary = `wakatime-cli${isWindows() ? ".exe" : ""}`;
    const command = isWindows() ? "where" : "which";
    const result = spawnSync(command, [binary], {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status !== 0) return undefined;

    const location = String(result.stdout || "")
      .split(/\r?\n/)
      .find(Boolean)
      ?.trim();

    if (!location) return undefined;

    if (!this.cliSupportsRequiredFlags(location)) {
      logger.warn("Global wakatime-cli is too old (missing AI heartbeat flags); using bundled CLI instead", { location });
      return undefined;
    }

    this.globalCliLocation = location;
    logger.debug("Using global wakatime-cli", { location });
    return location;
  }

  private cliSupportsRequiredFlags(cliPath: string): boolean {
    // Heartbeat args include flags added in recent wakatime-cli releases
    // (--sync-ai-disabled, --ai-line-changes). A stale global binary would
    // reject every heartbeat with "unknown flag", so probe capabilities first.
    const result = spawnSync(cliPath, ["--help"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });

    if (result.status !== 0) return false;
    const help = `${result.stdout || ""}${result.stderr || ""}`;
    return help.includes("--sync-ai-disabled") && help.includes("--ai-line-changes");
  }

  isCliInstalled(): boolean {
    return fs.existsSync(this.getCliLocation());
  }

  async checkAndInstallCli(): Promise<string> {
    const globalLocation = this.getCliLocationGlobal();
    if (globalLocation) return globalLocation;

    fs.mkdirSync(this.resourcesLocation, { recursive: true });

    if (!this.isCliInstalled()) {
      await this.installCli();
      return this.getCliLocation();
    }

    if (!(await this.shouldUpdateLocalCli())) return this.getCliLocation();

    try {
      await this.installCli();
    } catch (error) {
      logger.warn("Unable to update wakatime-cli; keeping existing binary", { error: String(error) });
    }

    return this.getCliLocation();
  }

  private async shouldUpdateLocalCli(): Promise<boolean> {
    const state = this.readState();
    const lastChecked = state.lastChecked ?? 0;
    if (Date.now() - lastChecked < UPDATE_CHECK_INTERVAL_MS) return false;

    const currentVersion = await this.getInstalledCliVersion();
    const latestVersion = await this.getLatestCliVersion();
    this.writeState({ lastChecked: Date.now(), version: latestVersion ?? currentVersion });

    if (!currentVersion || !latestVersion) return false;
    return currentVersion !== latestVersion;
  }

  private async getInstalledCliVersion(): Promise<string | undefined> {
    const cliPath = this.getCliLocation();
    if (!fs.existsSync(cliPath)) return undefined;

    const { promise, resolve } = Promise.withResolvers<string | undefined>();
    execFile(cliPath, ["--version"], this.execOptions(), (error: ExecFileException | null, stdout, stderr) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const version = `${stdout}${stderr}`.trim();
      resolve(version || undefined);
    });
    return promise;
  }

  private async getLatestCliVersion(): Promise<string | undefined> {
    try {
      const response = await this.getJson<ReleaseResponse>(GITHUB_RELEASES_URL);
      return response.tag_name;
    } catch (error) {
      logger.warn("Unable to check latest wakatime-cli version", { error: String(error) });
      return undefined;
    }
  }

  private async installCli(): Promise<void> {
    const archivePath = path.join(this.resourcesLocation, `wakatime-cli-${Date.now()}.zip`);
    const extractedName = this.platformBinaryName();
    const extractedPath = path.join(this.resourcesLocation, extractedName);
    const preferredPath = this.getCliLocation();

    logger.info("Downloading wakatime-cli", { url: this.cliDownloadUrl() });
    await this.downloadToFile(this.cliDownloadUrl(), archivePath);

    const backupPath = fs.existsSync(preferredPath) ? `${preferredPath}.backup` : undefined;
    if (backupPath) fs.renameSync(preferredPath, backupPath);

    try {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(this.resourcesLocation, true);

      if (fs.existsSync(extractedPath)) {
        fs.rmSync(preferredPath, { force: true });
        fs.renameSync(extractedPath, preferredPath);
      }

      if (!isWindows()) fs.chmodSync(preferredPath, 0o755);
      if (backupPath && fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
    } catch (error) {
      if (backupPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, preferredPath);
      throw error;
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  }

  private platformBinaryName(): string {
    return `wakatime-cli-${this.osName()}-${this.architecture()}${isWindows() ? ".exe" : ""}`;
  }

  private cliDownloadUrl(): string {
    return `${GITHUB_DOWNLOAD_URL}/wakatime-cli-${this.osName()}-${this.architecture()}.zip`;
  }

  private architecture(): string {
    const arch = os.arch();
    if (arch === "x64") return "amd64";
    if (arch === "ia32" || arch.includes("32")) return "386";
    return arch;
  }

  private osName(): string {
    return process.platform === "win32" ? "windows" : process.platform;
  }

  private execOptions(): ExecFileOptionsWithStringEncoding {
    return {
      encoding: "utf8",
      windowsHide: true,
    };
  }

  private readState(): CliState {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as CliState;
    } catch {
      return {};
    }
  }

  private writeState(state: CliState): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch {
      // CLI state persistence must not break tracking.
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.requestWithRedirects(url);
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const content = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(content) as T;
  }

  private async downloadToFile(url: string, destination: string): Promise<void> {
    const response = await this.requestWithRedirects(url);
    const statusCode = response.statusCode ?? 0;
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new Error(`Unexpected status code ${statusCode}`);
    }
    await pipeline(response, fs.createWriteStream(destination));
  }

  private async requestWithRedirects(url: string, redirectsLeft = 5): Promise<IncomingMessage> {
    const response = await this.sendRequest(url);
    const statusCode = response.statusCode ?? 0;
    const location = response.headers.location;

    if (statusCode >= 300 && statusCode < 400 && location && redirectsLeft > 0) {
      response.resume();
      return this.requestWithRedirects(new URL(location, url).toString(), redirectsLeft - 1);
    }

    return response;
  }

  private async sendRequest(url: string): Promise<IncomingMessage> {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();

    const request = transport.get(
      target,
      { headers: { "User-Agent": "omp-wakatime" } },
      (response) => resolve(response),
    );
    request.on("error", reject);
    request.end();

    return promise;
  }
}

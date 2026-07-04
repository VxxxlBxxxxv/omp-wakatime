// see DP.SC.182, DP.ROLE.071
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { VERSION as OMP_VERSION } from "@oh-my-pi/pi-coding-agent";
import { Dependencies } from "./dependencies.js";
import { HeartbeatSender } from "./heartbeat.js";
import { VERSION } from "./version.js";
import { logger } from "./logger.js";
import {
  flushPending,
  pendingCount,
  resolveAstEditDetails,
  resolveEditDetails,
  trackAstEdit,
  trackEdit,
  trackRead,
  trackWrite,
} from "./tracker.js";
import { resolvePath } from "./utils.js";
import { shouldSendHeartbeat, updateLastHeartbeat } from "./state.js";
import type { HeartbeatRequest } from "./types.js";



function buildPluginString(): string {
  return `oh-my-pi/${OMP_VERSION} omp-wakatime/${VERSION}`;
}

function sessionId(ctx: ExtensionContext): string {
  const manager = ctx.sessionManager as { getSessionId?: () => string } | undefined;
  return manager?.getSessionId?.() || ctx.cwd;
}

function inputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
}

export default function ompWakatime(pi: ExtensionAPI): void {
  pi.setLabel("WakaTime");

  const dependencies = new Dependencies();
  const sender = new HeartbeatSender({
    dependencies,
    plugin: buildPluginString(),
  });

  const initPromise = sender.init();
  let projectFolder = "";
  let currentSessionKey = "";

  pi.on("session_start", async (_event, ctx) => {
    projectFolder = ctx.cwd;
    currentSessionKey = sessionId(ctx);
    await initPromise;
    sender.track(buildSessionHeartbeat(ctx, currentSessionKey, "SessionStart"));
    logger.info("OMP WakaTime active", { projectFolder });
  });

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!projectFolder) projectFolder = ctx.cwd;
    if (!currentSessionKey) currentSessionKey = sessionId(ctx);

    await initPromise;
    sender.track(buildSessionHeartbeat(ctx, currentSessionKey, "PostToolUse"));

    if (event.isError) return;
    trackFileEvent(event, projectFolder);
    flushWhenReady(projectFolder, sender);
  });

  pi.on("session_shutdown", async () => {
    if (!projectFolder) return;

    await initPromise;

    const sessionRequest: HeartbeatRequest = {
      type: "session",
      entity: path.join(projectFolder, ".omp-session"),
      projectFolder,
      category: "coding",
      stateKey: currentSessionKey || projectFolder,
      sourceEvent: "SessionEnd",
    };

    await sender.trackForce(sessionRequest);
    updateLastHeartbeat(sessionRequest.stateKey);

    const payloads = flushPending(projectFolder);
    await Promise.all(payloads.map((payload) => sender.trackForce(payload)));
  });
}

function buildSessionHeartbeat(
  ctx: ExtensionContext,
  stateKey: string,
  sourceEvent: "SessionStart" | "PostToolUse" | "SessionEnd",
): HeartbeatRequest {
  return {
    type: "session",
    entity: path.join(ctx.cwd, ".omp-session"),
    projectFolder: ctx.cwd,
    category: "coding",
    stateKey,
    sourceEvent,
  };
}

function trackFileEvent(event: ToolResultEvent, projectFolder: string): void {
  const input = inputRecord(event.input);

  switch (event.toolName) {
    case "read": {
      if (typeof input.path === "string") trackRead(resolvePath(projectFolder, input.path));
      return;
    }
    case "write": {
      if (typeof input.path === "string") {
        trackWrite(resolvePath(projectFolder, input.path), typeof input.content === "string" ? input.content : undefined);
      }
      return;
    }
    case "edit": {
      trackEdit(resolveEditDetails(event.details, projectFolder));
      return;
    }
    case "ast_edit": {
      trackAstEdit(resolveAstEditDetails(event.details, projectFolder));
      return;
    }
    default:
      return;
  }
}

function flushWhenReady(projectFolder: string, sender: HeartbeatSender): void {
  if (pendingCount() === 0) return;
  if (!shouldSendHeartbeat(projectFolder)) return;

  const payloads = flushPending(projectFolder);
  updateLastHeartbeat(projectFolder);
  for (const payload of payloads) {
    sender.track(payload);
  }
}

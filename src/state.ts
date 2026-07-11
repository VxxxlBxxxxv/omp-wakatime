import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectStateDir } from "./paths.js";
import type { HeartbeatState } from "./types.js";

// WakaTime plugin guide: send a heartbeat when more than two minutes passed,
// the file changed, or the file was saved. This is the "two minutes" bound.
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 120_000;

function safeName(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function getStateFilePath(key: string): string {
  return path.join(getProjectStateDir(), `${safeName(key)}.json`);
}

export function readState(key: string): HeartbeatState {
  try {
    return JSON.parse(fs.readFileSync(getStateFilePath(key), "utf8")) as HeartbeatState;
  } catch {
    return {};
  }
}

export function writeState(key: string, state: HeartbeatState): void {
  try {
    const filePath = getStateFilePath(key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch {
    // State persistence must never break OMP.
  }
}

export function shouldSendHeartbeat(
  key: string,
  force = false,
  now = Date.now(),
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
): boolean {
  if (force) return true;
  const lastHeartbeatAt = readState(key).lastHeartbeatAt;
  if (typeof lastHeartbeatAt !== "number" || Number.isNaN(lastHeartbeatAt)) return true;
  return now - lastHeartbeatAt >= intervalMs;
}

export function updateLastHeartbeat(key: string, now = Date.now()): void {
  writeState(key, { lastHeartbeatAt: now });
}

// WakaTime plugin guide file-heartbeat rule: always send on a save/write; for a
// plain read, honour the per-file interval (a file never seen before has no
// stored timestamp, so its first read sends immediately = "the file changed").
export function shouldSendFileHeartbeat(entity: string, isWrite: boolean, now = Date.now()): boolean {
  return isWrite || shouldSendHeartbeat(entity, false, now);
}

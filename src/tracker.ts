import { isDirectory, countLines, resolvePath } from "./utils.js";
import type { AstEditDetails, EditDetails, FileHeartbeatRequest } from "./types.js";
import { logger } from "./logger.js";

type FileChange = {
  additions: number;
  deletions: number;
  isWrite: boolean;
};

const pending = new Map<string, FileChange>();

export function trackRead(filePath: string): void {
  if (!pending.has(filePath)) {
    pending.set(filePath, { additions: 0, deletions: 0, isWrite: false });
  }
}

export function trackWrite(filePath: string, content?: string): void {
  mergeChange(filePath, {
    additions: content ? countLines(content) : 0,
    deletions: 0,
    isWrite: true,
  });
}

export function trackEdit(details: EditDetails | undefined): void {
  if (!details) return;

  if (details.perFileResults && details.perFileResults.length > 0) {
    for (const result of details.perFileResults) {
      if (result.isError) continue;
      const change = result.diff ? countLineChanges(result.diff) : { additions: 1, deletions: 0 };
      mergeChange(result.path, { ...change, isWrite: true });
    }
    return;
  }

  if (details.files && details.files.length > 0) {
    for (const filePath of details.files) {
      const count = details.fileReplacements?.find((replacement) => replacement.path === filePath)?.count ?? 1;
      mergeChange(filePath, { additions: count, deletions: 0, isWrite: true });
    }
    return;
  }

  if (!details.path) return;
  const change = details.diff ? countLineChanges(details.diff) : { additions: 1, deletions: 0 };
  mergeChange(details.path, { ...change, isWrite: true });
}

export function trackAstEdit(details: AstEditDetails | undefined): void {
  if (!details?.files || details.files.length === 0) return;

  for (const filePath of details.files) {
    const count = details.fileReplacements?.find((replacement) => replacement.path === filePath)?.count ?? 1;
    mergeChange(filePath, { additions: count, deletions: 0, isWrite: true });
  }
}

export function resolveEditDetails(details: unknown, projectFolder: string): EditDetails | undefined {
  if (!isRecord(details)) return undefined;

  return {
    diff: typeof details.diff === "string" ? details.diff : undefined,
    path: typeof details.path === "string" ? resolvePath(projectFolder, details.path) : undefined,
    perFileResults: Array.isArray(details.perFileResults)
      ? details.perFileResults.flatMap((result) => resolvePerFileResult(result, projectFolder))
      : undefined,
    files: Array.isArray(details.files)
      ? details.files.filter((file): file is string => typeof file === "string").map((file) => resolvePath(projectFolder, file))
      : undefined,
    fileReplacements: Array.isArray(details.fileReplacements)
      ? details.fileReplacements.flatMap((replacement) => resolveReplacement(replacement, projectFolder))
      : undefined,
  };
}

export function resolveAstEditDetails(details: unknown, projectFolder: string): AstEditDetails | undefined {
  if (!isRecord(details)) return undefined;

  return {
    totalReplacements: typeof details.totalReplacements === "number" ? details.totalReplacements : undefined,
    filesTouched: typeof details.filesTouched === "number" ? details.filesTouched : undefined,
    filesSearched: typeof details.filesSearched === "number" ? details.filesSearched : undefined,
    applied: typeof details.applied === "boolean" ? details.applied : undefined,
    files: Array.isArray(details.files)
      ? details.files.filter((file): file is string => typeof file === "string").map((file) => resolvePath(projectFolder, file))
      : undefined,
    fileReplacements: Array.isArray(details.fileReplacements)
      ? details.fileReplacements.flatMap((replacement) => resolveReplacement(replacement, projectFolder))
      : undefined,
  };
}

export function flushPending(projectFolder: string): FileHeartbeatRequest[] {
  const payloads: FileHeartbeatRequest[] = [];

  for (const [entity, change] of pending) {
    if (isDirectory(entity)) {
      logger.debug("Skipping directory heartbeat", { entity });
      continue;
    }

    payloads.push({
      type: "file",
      entity,
      projectFolder,
      category: change.isWrite ? "ai coding" : "coding",
      isWrite: change.isWrite,
      lineChanges: change.additions - change.deletions,
      sourceEvent: "PostToolUse",
    });
  }

  pending.clear();
  return payloads;
}

export function pendingCount(): number {
  return pending.size;
}

function mergeChange(filePath: string, change: FileChange): void {
  const existing = pending.get(filePath);
  if (!existing) {
    pending.set(filePath, { ...change });
    return;
  }

  existing.additions += change.additions;
  existing.deletions += change.deletions;
  existing.isWrite = existing.isWrite || change.isWrite;
}

function countLineChanges(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) additions++;
    if (line.startsWith("-")) deletions++;
  }

  return { additions, deletions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolvePerFileResult(value: unknown, projectFolder: string): Array<{ path: string; diff?: string; isError?: boolean }> {
  if (!isRecord(value) || typeof value.path !== "string") return [];
  return [{
    path: resolvePath(projectFolder, value.path),
    diff: typeof value.diff === "string" ? value.diff : undefined,
    isError: typeof value.isError === "boolean" ? value.isError : undefined,
  }];
}

function resolveReplacement(value: unknown, projectFolder: string): Array<{ path: string; count: number }> {
  if (!isRecord(value) || typeof value.path !== "string") return [];
  return [{
    path: resolvePath(projectFolder, value.path),
    count: typeof value.count === "number" ? value.count : 1,
  }];
}

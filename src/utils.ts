import * as fs from "node:fs";
import * as path from "node:path";

export function isWindows(): boolean {
  return process.platform === "win32";
}

export function countLines(content?: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function resolvePath(projectFolder: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectFolder, filePath);
}

export function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}


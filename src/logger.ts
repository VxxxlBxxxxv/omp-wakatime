import * as fs from "node:fs";
import * as path from "node:path";
import { getLogPath } from "./paths.js";
import { isDebugEnabled } from "./options.js";

export enum LogLevel {
  INFO = 1,
  DEBUG = 2,
}

class Logger {
  private level: LogLevel = isDebugEnabled() ? LogLevel.DEBUG : LogLevel.INFO;

  setDebug(enabled: boolean): void {
    this.level = enabled ? LogLevel.DEBUG : LogLevel.INFO;
  }

  info(message: string, details?: unknown): void {
    this.write("INFO", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write("WARN", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("ERROR", message, details);
  }

  debug(message: string, details?: unknown): void {
    if (this.level < LogLevel.DEBUG) return;
    this.write("DEBUG", message, details);
  }

  errorException(error: unknown): void {
    this.error(error instanceof Error ? error.message : String(error));
  }

  private write(level: string, message: string, details?: unknown): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      message,
      details,
    };

    try {
      const logPath = getLogPath();
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
    } catch {
      // Logging must never break OMP.
    }
  }
}

export const logger = new Logger();

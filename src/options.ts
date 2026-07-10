import * as fs from "node:fs";
import { getWakatimeConfigPath } from "./paths.js";

export function getSetting(section: string, key: string): string | undefined {
  let content = "";
  try {
    content = fs.readFileSync(getWakatimeConfigPath(), "utf8");
  } catch {
    return undefined;
  }

  let currentSection = "";
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim().toLowerCase();
      continue;
    }
    if (currentSection !== section.toLowerCase()) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const foundKey = line.slice(0, separator).trim();
    if (foundKey !== key) continue;
    return line.slice(separator + 1).trim().replace(/\0/g, "");
  }

  return undefined;
}

export function isDebugEnabled(): boolean {
  return getSetting("settings", "debug") === "true" || process.env.OMP_WAKATIME_DEBUG === "1";
}

export function hasApiKey(): boolean {
  if (process.env.WAKATIME_API_KEY?.trim()) return true;
  if (getSetting("settings", "api_key")?.trim()) return true;
  // Vault command means the key is resolved by wakatime-cli at send time.
  if (getSetting("settings", "api_key_vault_cmd")?.trim()) return true;
  return false;
}

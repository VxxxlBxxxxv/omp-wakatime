import * as os from "node:os";
import * as path from "node:path";

function configuredWakatimeHome(): string | undefined {
  const value = process.env.WAKATIME_HOME?.trim();
  if (!value) return undefined;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function getWakatimeHomeDir(): string {
  return configuredWakatimeHome() ?? os.homedir();
}

export function getWakatimeResourcesDir(): string {
  return configuredWakatimeHome() ?? path.join(os.homedir(), ".wakatime");
}

export function getWakatimeConfigPath(): string {
  return path.join(getWakatimeHomeDir(), ".wakatime.cfg");
}

export function getLogPath(): string {
  return path.join(getWakatimeResourcesDir(), "omp-wakatime.log");
}

export function getCliStatePath(): string {
  return path.join(getWakatimeResourcesDir(), "omp-wakatime-cli-state.json");
}

export function getProjectStateDir(): string {
  return path.join(getWakatimeResourcesDir(), "omp-wakatime-state");
}

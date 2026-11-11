import { loadConfig, type AppConfig } from "@bbn/config";

let cached: AppConfig | null = null;
export function serverConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

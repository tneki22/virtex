import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

type Environment = Record<string, string | undefined>;

export interface RuntimeConfig {
  port: number;
  databasePath: string;
  ai: {
    apiKey: string;
    baseUrl: string;
    model: string;
  } | null;
}

export function loadEnvironmentFiles(
  root: string,
  target: Environment = process.env,
): void {
  const existingKeys = new Set(
    Object.entries(target)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  );

  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(root, fileName);
    if (!existsSync(filePath)) continue;
    const parsed = parseEnv(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!existingKeys.has(key)) target[key] = value;
    }
  }
}

export function resolveRuntimeConfig(root: string, environment: Environment): RuntimeConfig {
  const dataDirectory = path.resolve(root, environment.VIRTEX_DATA_DIR ?? "data");
  const databasePath = environment.DATABASE_PATH
    ? path.resolve(root, environment.DATABASE_PATH)
    : path.join(dataDirectory, "virtex.sqlite");
  const apiKey = environment.OPENAI_API_KEY?.trim();

  return {
    port: Number(environment.PORT ?? 4173),
    databasePath,
    ai: apiKey
      ? {
          apiKey,
          baseUrl: environment.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
          model: environment.OPENAI_MODEL ?? "openai/gpt-5-mini",
        }
      : null,
  };
}

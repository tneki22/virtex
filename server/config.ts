import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { RuntimeAIEnvironment } from "./runtime-ai.js";

type Environment = Record<string, string | undefined>;

export interface RuntimeConfig {
  port: number;
  databasePath: string;
  aiEnvironment: RuntimeAIEnvironment;
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
  const apiKey = (environment.OPENROUTER_API_KEY ?? environment.OPENAI_API_KEY)?.trim();
  const groqApiKey = environment.GROQ_API_KEY?.trim();

  return {
    port: Number(environment.PORT ?? 4173),
    databasePath,
    aiEnvironment: {
      openrouter: {
        apiKey,
        baseUrl: environment.OPENROUTER_BASE_URL ?? environment.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
        textModel: environment.OPENROUTER_TEXT_MODEL ?? environment.OPENAI_MODEL ?? "openai/gpt-5-mini",
        speechModel: environment.OPENROUTER_SPEECH_MODEL ?? "openai/whisper-large-v3",
        embeddingModel: environment.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
      },
      groq: {
        apiKey: groqApiKey,
        baseUrl: environment.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
        textModel: environment.GROQ_TEXT_MODEL ?? "openai/gpt-oss-20b",
        speechModel: environment.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
        embeddingModel: undefined,
      },
    },
  };
}

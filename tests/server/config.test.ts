// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "../../server/config.js";

describe("resolveRuntimeConfig", () => {
  it("uses the configured data directory and an OpenRouter-ready economical model", () => {
    const config = resolveRuntimeConfig("C:/project", {
      VIRTEX_DATA_DIR: "./private-data",
      OPENAI_API_KEY: "secret",
    });

    expect(config.databasePath).toMatch(/private-data[\\/]virtex\.sqlite$/);
    expect(config.aiEnvironment.openrouter).toEqual({
      apiKey: "secret",
      baseUrl: "https://openrouter.ai/api/v1",
      textModel: "openai/gpt-5-mini",
      speechModel: "openai/whisper-large-v3",
    });
  });

  it("configures Groq text and speech independently", () => {
    expect(resolveRuntimeConfig("C:/project", { GROQ_API_KEY: " key " }).aiEnvironment.groq).toEqual({
      apiKey: "key",
      baseUrl: "https://api.groq.com/openai/v1",
      textModel: "openai/gpt-oss-20b",
      speechModel: "whisper-large-v3-turbo",
    });
  });

  it("accepts the explicit OpenRouter key name before the legacy OpenAI-compatible name", () => {
    expect(resolveRuntimeConfig("C:/project", {
      OPENROUTER_API_KEY: "openrouter",
      OPENAI_API_KEY: "legacy",
    }).aiEnvironment.openrouter.apiKey).toBe("openrouter");
  });
});

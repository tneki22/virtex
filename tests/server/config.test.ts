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
    expect(config.ai?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.ai?.model).toBe("openai/gpt-5-mini");
  });

  it("configures Groq speech independently from answer checking", () => {
    expect(resolveRuntimeConfig("C:/project", { GROQ_API_KEY: " key " }).speech).toEqual({
      apiKey: "key",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
    });
  });
});

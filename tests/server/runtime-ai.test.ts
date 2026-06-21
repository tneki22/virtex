// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../server/database.js";
import { RuntimeAIService, type RuntimeAIEnvironment } from "../../server/runtime-ai.js";

const environment: RuntimeAIEnvironment = {
  openrouter: {
    apiKey: "env-openrouter-secret",
    baseUrl: "https://openrouter.test/api/v1",
    textModel: "openai/env-text",
    speechModel: "openai/env-whisper",
    embeddingModel: "openai/env-embedding",
  },
  groq: {
    apiKey: "env-groq-secret",
    baseUrl: "https://groq.test/openai/v1",
    textModel: "llama-env",
    speechModel: "whisper-env",
  },
};

function createService() {
  const database = createDatabase(":memory:");
  const createTextProvider = vi.fn((config: { model: string }) => ({
    model: config.model,
    capabilities: { chatStreaming: false },
    review: vi.fn(),
    chat: vi.fn(),
    testConnection: vi.fn(),
  }));
  const createSpeechProvider = vi.fn((config: { model: string }) => ({
    model: config.model,
    transcribe: vi.fn(),
  }));
  const createEmbeddingProvider = vi.fn((config: { model: string }) => ({
    model: config.model,
    embed: vi.fn(),
  }));
  const service = new RuntimeAIService({
    database,
    environment,
    factories: { createTextProvider, createSpeechProvider, createEmbeddingProvider },
  });
  return { database, service, createTextProvider, createSpeechProvider, createEmbeddingProvider };
}

describe("RuntimeAIService", () => {
  it("uses environment fallbacks without exposing key material", () => {
    const { service } = createService();

    expect(service.getState()).toEqual({
      keys: {
        openrouter: { configured: true, source: "environment" },
        groq: { configured: true, source: "environment" },
      },
      text: {
        provider: "openrouter",
        model: "openai/env-text",
        available: true,
        streamingPreference: "auto",
        streamingAvailable: false,
      },
      embeddings: {
        provider: "openrouter",
        model: "openai/env-embedding",
        available: true,
      },
      speech: { provider: "groq", model: "whisper-env", available: true },
    });
    expect(JSON.stringify(service.getState())).not.toContain("env-openrouter-secret");
    expect(JSON.stringify(service.getState())).not.toContain("env-groq-secret");
  });

  it("applies application overrides and returns to environment keys when cleared", () => {
    const { database, service, createTextProvider, createSpeechProvider } = createService();

    const updated = service.update({
      textProvider: "groq",
      textModel: "llama-3.3-70b-versatile",
      speechProvider: "openrouter",
      speechModel: "openai/whisper-large-v3",
      groqApiKey: "app-groq-secret",
      openrouterApiKey: "app-openrouter-secret",
    });

    expect(updated.keys).toEqual({
      openrouter: { configured: true, source: "application" },
      groq: { configured: true, source: "application" },
    });
    expect(service.getTextProvider()?.model).toBe("llama-3.3-70b-versatile");
    expect(service.getSpeechProvider()?.model).toBe("openai/whisper-large-v3");
    expect(createTextProvider).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: "groq",
      apiKey: "app-groq-secret",
      model: "llama-3.3-70b-versatile",
    }));
    expect(createSpeechProvider).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: "openrouter",
      apiKey: "app-openrouter-secret",
      model: "openai/whisper-large-v3",
    }));

    const cleared = service.update({
      textProvider: "groq",
      textModel: "llama-3.3-70b-versatile",
      speechProvider: "openrouter",
      speechModel: "openai/whisper-large-v3",
      clearGroqApiKey: true,
      clearOpenrouterApiKey: true,
    });

    expect(cleared.keys.groq.source).toBe("environment");
    expect(cleared.keys.openrouter.source).toBe("environment");
    expect(database.prepare("SELECT value FROM settings WHERE key = ?")
      .get("ai.groq.api_key")).toBeUndefined();
    expect(database.prepare("SELECT value FROM settings WHERE key = ?")
      .get("ai.openrouter.api_key")).toBeUndefined();
  });

  it("persists the text streaming preference independently from model settings", () => {
    const { database, service } = createService();

    const updated = service.update({
      textProvider: "openrouter",
      textModel: "openai/new-text",
      speechProvider: "groq",
      speechModel: "whisper-env",
      textStreamingPreference: "off",
    });

    expect(updated.text).toMatchObject({
      provider: "openrouter",
      model: "openai/new-text",
      streamingPreference: "off",
      streamingAvailable: false,
    });
    expect(database.prepare("SELECT value FROM settings WHERE key = ?")
      .get("ai.text.streaming")).toEqual({ value: "off" });
  });

  it("rejects an unavailable selected provider without changing active settings", () => {
    const database = createDatabase(":memory:");
    const service = new RuntimeAIService({
      database,
      environment: {
        openrouter: { ...environment.openrouter, apiKey: undefined },
        groq: { ...environment.groq, apiKey: undefined },
      },
    });
    const before = service.getState();

    expect(() => service.update({
      textProvider: "groq",
      textModel: "llama-new",
      speechProvider: "disabled",
      speechModel: "",
    })).toThrow(/GroqCloud API key/i);

    expect(service.getState()).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS count FROM settings").get())
      .toEqual({ count: 0 });
  });
});

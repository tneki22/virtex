// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../server/ai.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
  it("does not expose provider error details from connection tests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "Invalid key secret-key-value" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "secret-key-value",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    expect(await provider.testConnection()).toEqual({
      ok: false,
      model: "openai/gpt-5-mini",
      message: "Connection failed",
    });
  });

  it("tests the selected model with the structured output required by reviews", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "completion-1",
      object: "chat.completion",
      created: 1,
      model: "openai/gpt-5-mini",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    expect((await provider.testConnection()).ok).toBe(true);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("openai/gpt-5-mini");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("uses a plain bounded completion for tutor dialogue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "completion-1",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5-mini",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "  Tutor answer  " },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "Explain" }],
      estimatedInputTokens: 10,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(result).toBe("Tutor answer");
    expect(body.response_format).toBeUndefined();
    expect(body.max_completion_tokens).toBeLessThanOrEqual(1_200);
  });

  it("uses strict structured output and bounded completion tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "completion-1",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  action: "final",
                  examinerMessage: "Checked",
                  baseScore: 80,
                  personaVerdict: "Ready",
                  strengths: [],
                  gaps: [],
                  errors: [],
                  citations: [],
                  advice: "Continue",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    await provider.review({
      forceFinal: true,
      messages: [{ role: "user", content: "Review" }],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.challengeQuestions).toMatchObject({
      type: "array",
    });
    expect(body.max_completion_tokens).toBeLessThanOrEqual(900);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.seed).toBe(42);
  });

  it("falls back to a JSON-only completion when strict structured output is rejected", async () => {
    const review = {
      action: "final",
      examinerMessage: "Checked",
      baseScore: 80,
      personaVerdict: "Ready",
      strengths: [],
      gaps: [],
      errors: [],
      citations: [],
      advice: "Continue",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "response_format is not supported" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          id: "completion-2",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5-mini",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: `\`\`\`json\n${JSON.stringify(review)}\n\`\`\``,
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    await expect(provider.review({
      forceFinal: true,
      messages: [{ role: "user", content: "Review" }],
    })).resolves.toContain(JSON.stringify(review));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody.response_format).toBeUndefined();
    expect(retryBody.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Return only one valid JSON object"),
    });
  });

  it("returns invalid review content for server-side repair instead of throwing a parse error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "completion-1",
          object: "chat.completion",
          created: 1,
          model: "openai/gpt-5-mini",
          choices: [{
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "not json" },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/gpt-5-mini",
    });

    await expect(provider.review({
      forceFinal: true,
      messages: [{ role: "user", content: "Review" }],
    })).resolves.toBe("not json");
  });

  it("omits OpenRouter reasoning options for Groq text requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "completion-1",
      object: "chat.completion",
      created: 1,
      model: "openai/gpt-oss-20b",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Tutor" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAICompatibleProvider({
      provider: "groq",
      apiKey: "test-key",
      baseUrl: "https://groq.test/openai/v1",
      model: "openai/gpt-oss-20b",
    });

    await provider.chat({ messages: [{ role: "user", content: "Explain" }], estimatedInputTokens: 1 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.reasoning_effort).toBeUndefined();
  });
});

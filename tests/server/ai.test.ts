// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../../server/ai.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleProvider", () => {
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
    expect(body.max_completion_tokens).toBeLessThanOrEqual(900);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.seed).toBe(42);
  });
});

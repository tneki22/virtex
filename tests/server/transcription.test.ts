// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  GroqTranscriptionProvider,
  OpenRouterTranscriptionProvider,
} from "../../server/transcription.js";

describe("GroqTranscriptionProvider", () => {
  it("sends Russian audio with a short question-only prompt", async () => {
    const create = vi.fn().mockResolvedValue({ text: " Распознанный ответ " });
    const provider = new GroqTranscriptionProvider({
      apiKey: "test",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
    }, { audio: { transcriptions: { create } } });

    const result = await provider.transcribe({
      buffer: Buffer.from("audio"),
      fileName: "answer.webm",
      mimeType: "audio/webm",
      prompt: "Базы данных. Вопрос: транзакции. Акценты: ACID.",
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "whisper-large-v3-turbo",
      language: "ru",
      temperature: 0,
      response_format: "json",
      prompt: "Базы данных. Вопрос: транзакции. Акценты: ACID.",
    }));
    expect(result).toEqual({ text: "Распознанный ответ", model: "whisper-large-v3-turbo" });
  });
});

describe("OpenRouterTranscriptionProvider", () => {
  it("sends base64 audio to the selected OpenRouter STT model", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ text: " Распознанный OpenRouter ответ " }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const provider = new OpenRouterTranscriptionProvider({
      apiKey: "openrouter-key",
      baseUrl: "https://openrouter.test/api/v1",
      model: "openai/whisper-large-v3",
    }, fetcher);

    const result = await provider.transcribe({
      buffer: Buffer.from("audio"),
      fileName: "answer.webm",
      mimeType: "audio/webm",
      prompt: "Базы данных. Вопрос: транзакции.",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.test/api/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer openrouter-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(body).toEqual({
      model: "openai/whisper-large-v3",
      language: "ru",
      temperature: 0,
      input_audio: {
        data: Buffer.from("audio").toString("base64"),
        format: "webm",
      },
    });
    expect(result).toEqual({
      text: "Распознанный OpenRouter ответ",
      model: "openai/whisper-large-v3",
    });
  });
});

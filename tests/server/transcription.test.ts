// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { GroqTranscriptionProvider } from "../../server/transcription.js";

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

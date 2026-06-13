import OpenAI, { toFile } from "openai";

export interface TranscriptionInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  prompt: string;
}

export interface SpeechTranscriptionProvider {
  readonly model: string;
  transcribe(input: TranscriptionInput): Promise<{ text: string; model: string }>;
}

interface TranscriptionClient {
  audio: {
    transcriptions: {
      create(input: Record<string, unknown>): Promise<{ text: string }>;
    };
  };
}

export class GroqTranscriptionProvider implements SpeechTranscriptionProvider {
  readonly model: string;
  private readonly client: TranscriptionClient;

  constructor(
    config: { apiKey: string; baseUrl: string; model: string },
    client?: TranscriptionClient,
  ) {
    this.model = config.model;
    this.client = client ?? new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    }) as unknown as TranscriptionClient;
  }

  async transcribe(input: TranscriptionInput): Promise<{ text: string; model: string }> {
    const file = await toFile(input.buffer, input.fileName, { type: input.mimeType });
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: "ru",
      temperature: 0,
      response_format: "json",
      prompt: input.prompt.slice(0, 900),
    });
    return { text: result.text.trim(), model: this.model };
  }
}

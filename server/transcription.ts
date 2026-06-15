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

export class OpenRouterTranscriptionProvider implements SpeechTranscriptionProvider {
  readonly model: string;
  private readonly endpoint: string;

  constructor(
    private readonly config: { apiKey: string; baseUrl: string; model: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.model = config.model;
    this.endpoint = `${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  }

  async transcribe(input: TranscriptionInput): Promise<{ text: string; model: string }> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        language: "ru",
        temperature: 0,
        input_audio: {
          data: input.buffer.toString("base64"),
          format: audioFormat(input.mimeType, input.fileName),
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter transcription failed with status ${response.status}`);
    }
    const result = await response.json() as { text?: string };
    const text = result.text?.trim();
    if (!text) throw new Error("OpenRouter transcription returned an empty response");
    return { text, model: this.model };
  }
}

function audioFormat(mimeType: string, fileName: string): string {
  const normalizedMimeType = mimeType.split(";")[0].toLowerCase();
  const byMimeType: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
  };
  return byMimeType[normalizedMimeType]
    ?? fileName.split(".").at(-1)?.toLowerCase()
    ?? "webm";
}

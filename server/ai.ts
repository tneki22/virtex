import OpenAI from "openai";
import type { ReviewMessage, TutorRequest } from "./prompt.js";

export interface ReviewProviderInput {
  messages: ReviewMessage[];
  forceFinal: boolean;
  repair?: boolean;
}

export interface AIProvider {
  readonly model: string;
  review(input: ReviewProviderInput): Promise<unknown>;
  chat(input: TutorRequest): Promise<string>;
  testConnection(): Promise<{ ok: boolean; model: string; message?: string }>;
}

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  async review(input: ReviewProviderInput): Promise<unknown> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "exam_review",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", enum: ["clarify", "final"] },
              examinerMessage: { type: "string" },
              baseScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
              personaVerdict: { type: "string" },
              strengths: { type: "array", items: { type: "string" } },
              gaps: { type: "array", items: { type: "string" } },
              errors: { type: "array", items: { type: "string" } },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    documentId: { type: "string" },
                    page: { type: "integer", minimum: 1 },
                    fragmentId: { type: ["string", "null"] },
                    note: { type: ["string", "null"] },
                  },
                  required: ["documentId", "page", "fragmentId", "note"],
                },
              },
              advice: { type: "string" },
            },
            required: [
              "action",
              "examinerMessage",
              "baseScore",
              "personaVerdict",
              "strengths",
              "gaps",
              "errors",
              "citations",
              "advice",
            ],
          },
        },
      },
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_completion_tokens: 850,
      reasoning_effort: "minimal",
      seed: 42,
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return JSON.parse(content);
  }

  async chat(input: TutorRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: input.messages,
      max_completion_tokens: 1_200,
      reasoning_effort: "minimal",
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
  }

  async testConnection() {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_completion_tokens: 16,
        reasoning_effort: "minimal",
      });
      return { ok: true, model: this.model };
    } catch (error) {
      return {
        ok: false,
        model: this.model,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }
}

import OpenAI from "openai";
import type { AIProviderId } from "../shared/contracts.js";
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
  provider?: AIProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly provider: AIProviderId;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.provider = config.provider ?? "openrouter";
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
      ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
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
      ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
  }

  async testConnection() {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "connection_test",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            },
          },
        },
        messages: [{ role: "user", content: "Return a JSON object with ok set to true." }],
        max_completion_tokens: 32,
        ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
      });
      return { ok: true, model: this.model };
    } catch {
      return {
        ok: false,
        model: this.model,
        message: "Connection failed",
      };
    }
  }
}

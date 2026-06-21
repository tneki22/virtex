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
  readonly capabilities: { chatStreaming: boolean };
  review(input: ReviewProviderInput): Promise<unknown>;
  chat(input: TutorRequest): Promise<string>;
  chatStream?(input: TutorRequest): AsyncIterable<string>;
  testConnection(): Promise<{ ok: boolean; model: string; message?: string }>;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(input: string[]): Promise<number[][]>;
}

export interface OpenAICompatibleConfig {
  provider?: AIProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

const REVIEW_RESPONSE_FORMAT = {
  type: "json_schema" as const,
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
        challengeQuestions: { type: "array", items: { type: "string" } },
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
};

const JSON_ONLY_INSTRUCTION =
  "Return only one valid JSON object. Do not wrap it in markdown or add commentary.";

const REVIEW_REPAIR_INSTRUCTION = [
  "Previous review response failed validation. Return a corrected review now.",
  "Return only one valid JSON object matching the exam_review schema.",
  "If action is final, baseScore must be a number from 0 to 100.",
  "If action is clarify, baseScore must be null.",
  "Citations must use exact documentId, page, and fragmentId values from the supplied exam_context sources. If no exact source applies, return an empty citations array.",
  "Do not include markdown, commentary, or fields outside the schema.",
].join(" ");

export class OpenAICompatibleProvider implements AIProvider {
  readonly model: string;
  readonly capabilities = { chatStreaming: true };
  private readonly client: OpenAI;
  private readonly provider: AIProviderId;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.provider = config.provider ?? "openrouter";
    this.client = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  async review(input: ReviewProviderInput): Promise<unknown> {
    const messages = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const reviewMessages = input.repair
      ? [
          {
            role: "system" as const,
            content: `${REVIEW_REPAIR_INSTRUCTION} ${input.forceFinal ? "For this request action must be final." : ""}`.trim(),
          },
          ...messages,
        ]
      : messages;
    const baseRequest = {
      model: this.model,
      messages: reviewMessages,
      max_completion_tokens: 1_600,
      ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
      seed: input.repair ? 43 : 42,
    };

    let response;
    try {
      response = await this.client.chat.completions.create({
        ...baseRequest,
        response_format: REVIEW_RESPONSE_FORMAT,
      });
    } catch {
      response = await this.client.chat.completions.create({
        ...baseRequest,
        messages: [
          { role: "system" as const, content: JSON_ONLY_INSTRUCTION },
          ...reviewMessages,
        ],
      });
    }
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return content.trim();
  }

  async chat(input: TutorRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: input.messages,
      max_completion_tokens: input.maxCompletionTokens ?? 1_200,
      ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
  }

  async *chatStream(input: TutorRequest): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: input.messages,
      max_completion_tokens: input.maxCompletionTokens ?? 1_200,
      stream: true,
      ...(this.provider === "openrouter" ? { reasoning_effort: "minimal" as const } : {}),
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
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

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(config: OpenAICompatibleConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  async embed(input: string[]): Promise<number[][]> {
    if (input.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input,
    });
    return response.data
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }
}

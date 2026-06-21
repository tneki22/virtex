import request from "supertest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamPackage } from "../../shared/contracts.js";
import { createApp } from "../../server/app.js";
import type { AIProvider, EmbeddingProvider, ReviewProviderInput } from "../../server/ai.js";
import { createDatabase } from "../../server/database.js";
import type { TutorRequest } from "../../server/prompt.js";
import { RuntimeAIService } from "../../server/runtime-ai.js";
import { RuntimePromptService } from "../../server/runtime-prompts.js";

const exam: ExamPackage = {
  id: "exam",
  version: "1.0.0",
  title: "Database exam",
  description: "Fixture",
  subject: "Databases",
  profiles: [
    { id: "neutral", name: "Neutral", description: "Neutral", tone: "neutral" },
  ],
  documents: [
    {
      id: "book",
      title: "Book",
      type: "text",
      path: "book.txt",
      pageCount: 1,
      fragments: [{ id: "book-p1-f1", page: 1, text: "A transaction is atomic." }],
    },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "What is a transaction?",
      displayText: "What is a transaction?",
      groupId: "core",
      groupTitle: "Core",
      referenceAnswer: "A transaction is a logical and atomic unit of work.",
      emphasis: ["atomic"],
      sources: [{ documentId: "book", page: 1, fragmentId: "book-p1-f1" }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: {
    timerMinutes: null,
    maxFollowUps: 2,
    referenceReveal: "after_attempt_or_explicit",
  },
  styleGuide: "Be precise.",
};

const finalReview = {
  action: "final",
  examinerMessage: "The answer is mostly correct.",
  baseScore: 84,
  personaVerdict: "Ready with a minor gap.",
  strengths: ["Defines atomicity"],
  gaps: ["Mention isolation"],
  errors: [],
  citations: [{ documentId: "book", page: 1, fragmentId: "book-p1-f1" }],
  advice: "Add the remaining ACID properties.",
};

class SequenceProvider implements AIProvider {
  readonly model = "fake-model";
  calls: ReviewProviderInput[] = [];
  readonly capabilities = { chatStreaming: false };

  constructor(private readonly responses: unknown[]) {}

  async review(input: ReviewProviderInput): Promise<unknown> {
    this.calls.push(input);
    return this.responses.shift();
  }

  async chat(_input: TutorRequest) {
    return "Tutor response";
  }

  async testConnection() {
    return { ok: true, model: this.model };
  }
}

class StreamingProvider extends SequenceProvider {
  override readonly capabilities = { chatStreaming: true };

  constructor(private readonly chunks: string[], private readonly failAfterChunks = false) {
    super([]);
  }

  override async chat(_input: TutorRequest) {
    return this.chunks.join("");
  }

  async *chatStream(_input: TutorRequest) {
    for (const chunk of this.chunks) yield chunk;
    if (this.failAfterChunks) throw new Error("stream failed");
  }
}

class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly model = "test-embedding";

  async embed(input: string[]): Promise<number[][]> {
    return input.map((text) => {
      const normalized = text.toLocaleLowerCase("en");
      return [
        normalized.includes("transaction") || normalized.includes("atomic") ? 1 : 0,
        normalized.includes("index") ? 1 : 0,
      ];
    });
  }
}

async function readNdjson(response: request.Response) {
  return String(response.text)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; delta?: string; error?: string });
}

async function createSession(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/api/sessions").send({
    examId: "exam",
    questionId: "q-1",
    mode: "study",
    profileId: "neutral",
  });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

describe("exam API", () => {
  let database: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  it("applies saved text and speech providers to subsequent requests without restart", async () => {
    const textCalls: Array<{ provider: string; model: string; kind: string }> = [];
    const speechCalls: Array<{ provider: string; model: string }> = [];
    const runtimeAI = new RuntimeAIService({
      database,
      environment: {
        openrouter: {
          apiKey: "env-openrouter",
          baseUrl: "https://openrouter.test/api/v1",
          textModel: "openai/old-text",
          speechModel: "openai/old-speech",
        },
        groq: {
          apiKey: "env-groq",
          baseUrl: "https://groq.test/openai/v1",
          textModel: "llama-old",
          speechModel: "whisper-old",
        },
      },
      factories: {
        createTextProvider: ({ provider, model }) => ({
          model,
          capabilities: { chatStreaming: false },
          async chat() {
            textCalls.push({ provider, model, kind: "chat" });
            return "Runtime tutor response";
          },
          async review() {
            textCalls.push({ provider, model, kind: "review" });
            return finalReview;
          },
          async testConnection() {
            textCalls.push({ provider, model, kind: "test" });
            return { ok: true, model };
          },
        }),
        createSpeechProvider: ({ provider, model }) => ({
          model,
          async transcribe() {
            speechCalls.push({ provider, model });
            return { text: "Runtime transcript", model };
          },
        }),
      },
    });
    const app = createApp({ database, exams: [exam], runtimeAI });

    const saved = await request(app).put("/api/settings/ai").send({
      textProvider: "groq",
      textModel: "llama-new",
      speechProvider: "openrouter",
      speechModel: "openai/whisper-new",
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      text: { provider: "groq", model: "llama-new" },
      speech: { provider: "openrouter", model: "openai/whisper-new" },
    });
    expect(JSON.stringify(saved.body)).not.toContain("env-openrouter");

    const tutor = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "tutor", profileId: "neutral" });
    expect((await request(app)
      .post(`/api/chats/${tutor.body.id}/messages`)
      .send({ content: "Explain runtime settings" })).status).toBe(201);

    const reviewChat = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "review", profileId: "neutral" });
    const reviewed = await request(app)
      .post(`/api/chats/${reviewChat.body.id}/review`)
      .send({ answer: "A transaction is an atomic unit of work." });
    expect(reviewed.body.model).toBe("llama-new");

    const textTest = await request(app).post("/api/settings/ai/test-text").send({});
    expect(textTest.body).toEqual({ ok: true, provider: "groq", model: "llama-new" });

    const transcribed = await request(app)
      .post("/api/transcriptions")
      .field("questionId", "q-1")
      .attach("audio", Buffer.from("audio"), {
        filename: "answer.webm",
        contentType: "audio/webm",
      });
    expect(transcribed.body).toMatchObject({
      text: "Runtime transcript",
      model: "openai/whisper-new",
      provider: "openrouter",
    });
    const speechTest = await request(app)
      .post("/api/settings/ai/test-speech")
      .attach("audio", Buffer.from("audio"), {
        filename: "test.webm",
        contentType: "audio/webm",
      });
    expect(speechTest.body).toMatchObject({
      ok: true,
      provider: "openrouter",
      model: "openai/whisper-new",
      text: "Runtime transcript",
    });
    expect(textCalls).toEqual([
      { provider: "groq", model: "llama-new", kind: "chat" },
      { provider: "groq", model: "llama-new", kind: "review" },
      { provider: "groq", model: "llama-new", kind: "test" },
    ]);
    expect(speechCalls).toEqual([
      { provider: "openrouter", model: "openai/whisper-new" },
      { provider: "openrouter", model: "openai/whisper-new" },
    ]);
  });

  it("uses the saved runtime text model for document study chat turns", async () => {
    const textCalls: Array<{ provider: string; model: string; request: TutorRequest }> = [];
    const runtimeAI = new RuntimeAIService({
      database,
      environment: {
        openrouter: {
          apiKey: "env-openrouter",
          baseUrl: "https://openrouter.test/api/v1",
          textModel: "openai/old-text",
          speechModel: "openai/old-speech",
          embeddingModel: "openai/old-embedding",
        },
        groq: {
          apiKey: "env-groq",
          baseUrl: "https://groq.test/openai/v1",
          textModel: "llama-old",
          speechModel: "whisper-old",
        },
      },
      factories: {
        createTextProvider: ({ provider, model }) => ({
          model,
          capabilities: { chatStreaming: false },
          async chat(requestInput) {
            textCalls.push({ provider, model, request: requestInput });
            return "Runtime document response";
          },
          async review() {
            return finalReview;
          },
          async testConnection() {
            return { ok: true, model };
          },
        }),
        createEmbeddingProvider: ({ model }) => ({
          model,
          async embed(input) {
            return input.map((text) => {
              const normalized = text.toLocaleLowerCase("en");
              return [
                normalized.includes("transaction") || normalized.includes("atomic") ? 1 : 0,
                normalized.includes("index") ? 1 : 0,
              ];
            });
          },
        }),
        createSpeechProvider: ({ model }) => ({
          model,
          async transcribe() {
            return { text: "unused", model };
          },
        }),
      },
    });
    const app = createApp({ database, exams: [exam], runtimeAI });

    const saved = await request(app).put("/api/settings/ai").send({
      textProvider: "groq",
      textModel: "llama-doc-new",
      textStreamingPreference: "auto",
      speechProvider: "disabled",
      speechModel: "",
      embeddingModel: "openai/new-embedding",
    });
    expect(saved.status).toBe(200);

    expect((await request(app).post("/api/exams/exam/documents/book/index").send({})).status)
      .toBe(200);
    const chat = await request(app)
      .post("/api/exams/exam/documents/book/chats")
      .send({ profileId: "neutral" });
    const turn = await request(app)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({ content: "Explain transactions" });

    expect(turn.status).toBe(201);
    expect(turn.body.assistant.content).toBe("Runtime document response");
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]).toMatchObject({ provider: "groq", model: "llama-doc-new" });
    expect(textCalls[0].request.maxCompletionTokens).toBe(6_000);
    expect(textCalls[0].request.estimatedInputTokens).toBeLessThanOrEqual(14_000);
  });

  it("creates, lists, restores, and continues tutor chats without extra reads from AI", async () => {
    const provider = new SequenceProvider([]);
    const chatSpy = vi.spyOn(provider, "chat");
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "tutor", profileId: "neutral" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "tutor", title: "Разбор темы", messages: [] });

    const turn = await request(app)
      .post(`/api/chats/${created.body.id}/messages`)
      .send({ content: "Explain with pizza delivery" });
    expect(turn.status).toBe(201);
    expect(turn.body.user.content).toBe("Explain with pizza delivery");
    expect(turn.body.assistant.content).toBe("Tutor response");
    expect(chatSpy).toHaveBeenCalledTimes(1);

    const history = await request(app).get("/api/exams/exam/questions/q-1/chats");
    expect(history.body[0].title).toBe("Explain with pizza delivery");
    const restored = await request(app).get(`/api/chats/${created.body.id}`);
    expect(restored.body.messages).toHaveLength(2);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("streams tutor chat chunks and persists the completed turn once", async () => {
    const provider = new StreamingProvider(["First ", "chunk"]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "tutor", profileId: "neutral" });

    const response = await request(app)
      .post(`/api/chats/${created.body.id}/messages/stream`)
      .send({ content: "Explain streaming" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/x-ndjson/);
    expect(await readNdjson(response)).toEqual([
      { type: "chunk", delta: "First " },
      { type: "chunk", delta: "chunk" },
      expect.objectContaining({ type: "done" }),
    ]);
    const restored = await request(app).get(`/api/chats/${created.body.id}`);
    expect(restored.body.messages.map((message: { content: string }) => message.content)).toEqual([
      "Explain streaming",
      "First chunk",
    ]);
  });

  it("indexes a searchable document and chats with retrieved source fragments", async () => {
    const documentExam: ExamPackage = {
      ...exam,
      documents: [
        {
          id: "questions",
          title: "Questions",
          type: "text",
          path: "questions.txt",
          pageCount: 1,
          role: "questions",
          searchable: false,
          fragments: [{ id: "questions-p1-f1", page: 1, text: "Official question text" }],
        },
        {
          id: "book",
          title: "Book",
          type: "text",
          path: "book.txt",
          pageCount: 2,
          role: "textbook",
          searchable: true,
          fragments: [
            { id: "book-p1-f1", page: 1, text: "A transaction is an atomic unit of work." },
            { id: "book-p2-f1", page: 2, text: "Indexes speed up lookups." },
          ],
        },
      ],
    };
    const provider = new SequenceProvider([]);
    const chatSpy = vi.spyOn(provider, "chat");
    const app = createApp({
      database,
      exams: [documentExam],
      aiProvider: provider,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });

    const documents = await request(app).get("/api/exams/exam/document-study/documents");
    expect(documents.status).toBe(200);
    expect(documents.body).toEqual([
      expect.objectContaining({ id: "book", searchable: true, indexStatus: { state: "missing" } }),
    ]);

    const indexed = await request(app).post("/api/exams/exam/documents/book/index").send({});
    expect(indexed.status).toBe(200);
    expect(indexed.body).toMatchObject({ state: "ready", indexedFragments: 2 });

    const chat = await request(app)
      .post("/api/exams/exam/documents/book/chats")
      .send({ profileId: "neutral" });
    expect(chat.status).toBe(201);
    expect(chat.body).toMatchObject({
      kind: "document",
      scopeType: "document",
      documentId: "book",
    });

    const turn = await request(app)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({ content: "Explain transactions" });
    expect(turn.status).toBe(201);
    expect(turn.body.assistant.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentId: "book",
        fragmentId: "book-p1-f1",
        score: expect.any(Number),
      }),
    ]));
    expect(JSON.stringify(chatSpy.mock.calls[0][0].messages)).toContain("A transaction is an atomic unit of work");
    expect(JSON.stringify(chatSpy.mock.calls[0][0].messages)).not.toContain("Official question text");

    const restored = await request(app).get(`/api/chats/${chat.body.id}`);
    expect(restored.body.messages[1].sources).toEqual(turn.body.assistant.sources);
  });

  it("uses the expanded document RAG profile for document chat turns", async () => {
    const documentExam: ExamPackage = {
      ...exam,
      documents: [{
        id: "book",
        title: "Book",
        type: "text",
        path: "book.txt",
        pageCount: 12,
        role: "textbook",
        searchable: true,
        fragments: Array.from({ length: 12 }, (_, index) => ({
          id: `book-p${index + 1}-f1`,
          page: index + 1,
          text: `Transaction topic section ${index + 1}. ${"x".repeat(900)}`,
        })),
      }],
    };
    const provider = new SequenceProvider([]);
    const chatSpy = vi.spyOn(provider, "chat");
    const app = createApp({
      database,
      exams: [documentExam],
      aiProvider: provider,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });
    await request(app).post("/api/exams/exam/documents/book/index").send({});
    const chat = await request(app)
      .post("/api/exams/exam/documents/book/chats")
      .send({ profileId: "neutral" });

    const turn = await request(app)
      .post(`/api/chats/${chat.body.id}/messages`)
      .send({ content: "Explain transaction topics in detail" });

    const tutorRequest = chatSpy.mock.calls[0][0] as TutorRequest & { maxCompletionTokens?: number };
    expect(turn.status).toBe(201);
    expect(turn.body.assistant.sources.length).toBeGreaterThan(6);
    expect(tutorRequest.maxCompletionTokens).toBe(6_000);
    expect(tutorRequest.estimatedInputTokens).toBeLessThanOrEqual(14_000);
  });

  it("falls back to current exam document ids when compiled metadata has no searchable flags", async () => {
    const legacyCompiledExam: ExamPackage = {
      ...exam,
      documents: [
        {
          id: "official-questions",
          title: "Questions",
          type: "text",
          path: "questions.txt",
          pageCount: 1,
          fragments: [{ id: "official-questions-p1-f1", page: 1, text: "Official question text" }],
        },
        {
          id: "detailed-answers",
          title: "Detailed answers",
          type: "text",
          path: "answers.txt",
          pageCount: 1,
          fragments: [{ id: "detailed-answers-p1-f1", page: 1, text: "Reference material" }],
        },
        {
          id: "textbook",
          title: "Textbook",
          type: "text",
          path: "book.txt",
          pageCount: 1,
          fragments: [{ id: "textbook-p1-f1", page: 1, text: "Expanded material" }],
        },
      ],
    };
    const app = createApp({
      database,
      exams: [legacyCompiledExam],
      aiProvider: new SequenceProvider([]),
      embeddingProvider: new KeywordEmbeddingProvider(),
    });

    const documents = await request(app).get("/api/exams/exam/document-study/documents");

    expect(documents.status).toBe(200);
    expect(documents.body.map((document: { id: string }) => document.id)).toEqual([
      "detailed-answers",
      "textbook",
    ]);
    expect(documents.body.every((document: { searchable: boolean }) => document.searchable)).toBe(true);
  });

  it("keeps a failed streamed document turn out of persisted history", async () => {
    const documentExam: ExamPackage = {
      ...exam,
      documents: [{
        id: "book",
        title: "Book",
        type: "text",
        path: "book.txt",
        pageCount: 1,
        role: "textbook",
        searchable: true,
        fragments: [{ id: "book-p1-f1", page: 1, text: "A transaction is atomic." }],
      }],
    };
    const provider = new StreamingProvider(["partial"], true);
    const app = createApp({
      database,
      exams: [documentExam],
      aiProvider: provider,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });
    await request(app).post("/api/exams/exam/documents/book/index").send({});
    const created = await request(app)
      .post("/api/exams/exam/documents/book/chats")
      .send({ profileId: "neutral" });

    const response = await request(app)
      .post(`/api/chats/${created.body.id}/messages/stream`)
      .send({ content: "Explain transaction" });

    expect(response.status).toBe(200);
    expect(await readNdjson(response)).toEqual([
      { type: "chunk", delta: "partial" },
      { type: "error", error: "AI tutor stream failed" },
    ]);
    expect((await request(app).get(`/api/chats/${created.body.id}`)).body.messages).toEqual([]);
  });

  it("keeps a failed streamed tutor turn out of persisted history", async () => {
    const provider = new StreamingProvider(["partial"], true);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "tutor", profileId: "neutral" });

    const response = await request(app)
      .post(`/api/chats/${created.body.id}/messages/stream`)
      .send({ content: "Do not persist stream" });

    expect(response.status).toBe(200);
    expect(await readNdjson(response)).toEqual([
      { type: "chunk", delta: "partial" },
      { type: "error", error: "AI tutor stream failed" },
    ]);
    expect((await request(app).get(`/api/chats/${created.body.id}`)).body.messages).toEqual([]);
  });

  it("keeps a failed tutor turn out of persisted history", async () => {
    const provider = new SequenceProvider([]);
    vi.spyOn(provider, "chat").mockRejectedValue(new Error("provider failed"));
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "tutor", profileId: "neutral" });

    expect((await request(app)
      .post(`/api/chats/${created.body.id}/messages`)
      .send({ content: "Do not persist me" })).status).toBe(502);
    expect((await request(app).get(`/api/chats/${created.body.id}`)).body.messages).toEqual([]);
  });

  it("restores a completed review chat and rejects further review", async () => {
    const provider = new SequenceProvider([finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app)
      .post("/api/exams/exam/questions/q-1/chats")
      .send({ kind: "review", profileId: "neutral" });
    const reviewed = await request(app)
      .post(`/api/chats/${created.body.id}/review`)
      .send({ answer: "A transaction is atomic." });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.baseScore).toBe(84);

    const restored = await request(app).get(`/api/chats/${created.body.id}`);
    expect(restored.body.status).toBe("completed");
    expect(restored.body.reviews.at(-1).baseScore).toBe(84);
    expect((await request(app)
      .post(`/api/chats/${created.body.id}/review`)
      .send({ answer: "Try again" })).status).toBe(409);
  });

  it("transcribes audio without exposing the reference answer", async () => {
    const transcribe = vi.fn().mockResolvedValue({
      text: "Распознанный ответ",
      model: "whisper-large-v3-turbo",
    });
    const app = createApp({
      database,
      exams: [exam],
      aiProvider: null,
      speechProvider: { model: "whisper-large-v3-turbo", transcribe },
    });

    const response = await request(app)
      .post("/api/transcriptions")
      .field("questionId", "q-1")
      .attach("audio", Buffer.from("audio"), {
        filename: "answer.webm",
        contentType: "audio/webm",
      });

    expect(response.status).toBe(200);
    expect(response.body.text).toBe("Распознанный ответ");
    const prompt = transcribe.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("What is a transaction?");
    expect(prompt).not.toContain(exam.questions[0].referenceAnswer);
  });

  it("reports unavailable speech configuration", async () => {
    const app = createApp({ database, exams: [exam], aiProvider: null });
    expect((await request(app).post("/api/transcriptions")).status).toBe(503);
  });

  it("reports provider configuration without exposing credentials", async () => {
    const runtimeAI = new RuntimeAIService({
      database,
      environment: {
        openrouter: {
          apiKey: undefined,
          baseUrl: "https://openrouter.test/api/v1",
          textModel: "openai/text",
          speechModel: "openai/whisper",
        },
        groq: {
          apiKey: "groq-secret",
          baseUrl: "https://groq.test/openai/v1",
          textModel: "llama",
          speechModel: "whisper",
        },
      },
      factories: {
        createTextProvider: ({ model }) => ({
          model,
          capabilities: { chatStreaming: false },
          review: vi.fn(),
          chat: vi.fn(),
          testConnection: vi.fn(),
        }),
        createSpeechProvider: ({ model }) => ({ model, transcribe: vi.fn() }),
      },
    });
    const app = createApp({
      database,
      exams: [exam],
      runtimeAI,
    });
    const body = (await request(app).get("/api/settings/ai")).body;
    expect(body).toMatchObject({
      keys: {
        openrouter: { configured: false, source: "missing" },
        groq: { configured: true, source: "environment" },
      },
      text: { provider: "groq", model: "llama", available: true },
      speech: { provider: "groq", model: "whisper", available: true },
    });
    expect(JSON.stringify(body)).not.toContain("groq-secret");
  });

  it("saves prompt settings, resolves active profiles, and keeps archived profiles usable for existing sessions", async () => {
    const provider = new SequenceProvider([finalReview, finalReview]);
    const runtimePrompts = new RuntimePromptService({ database });
    const app = createApp({ database, exams: [exam], aiProvider: provider, runtimePrompts });

    const beforeArchive = await request(app).post("/api/sessions").send({
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      profileId: "neutral",
    });
    expect(beforeArchive.status).toBe(201);

    const settings = await request(app).get("/api/exams/exam/prompts");
    expect(settings.status).toBe(200);
    const neutral = settings.body.profiles[0];
    expect(neutral.systemPrompts.studyReview).toContain("Persona:");

    const saved = await request(app).put("/api/exams/exam/prompts").send({
      profiles: [
        {
          ...neutral,
          name: "Archived neutral",
          archived: true,
          systemPrompts: {
            ...neutral.systemPrompts,
            studyReview: "Archived profile review instructions",
          },
        },
        {
          id: "custom",
          name: "Custom coach",
          description: "User-owned examiner profile",
          tone: "strict",
          quickPrompts: [{ id: "drill", label: "Drill", prompt: "Ask five short questions" }],
          systemPrompts: {
            studyTutor: "Custom tutor instructions",
            studyReview: "Custom review instructions",
            examFinal: "Custom exam instructions",
          },
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.profiles.map((profile: { id: string }) => profile.id)).toEqual(["neutral", "custom"]);
    expect(saved.body.profiles[0]).toMatchObject({ id: "neutral", archived: true });

    const examDetail = await request(app).get("/api/exams/exam");
    expect(examDetail.body.profiles).toEqual([
      expect.objectContaining({
        id: "custom",
        name: "Custom coach",
        quickPrompts: [{ id: "drill", label: "Drill", prompt: "Ask five short questions" }],
      }),
    ]);

    const newArchivedSession = await request(app).post("/api/sessions").send({
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      profileId: "neutral",
    });
    expect(newArchivedSession.status).toBe(400);

    const customSession = await request(app).post("/api/sessions").send({
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      profileId: "custom",
    });
    expect(customSession.status).toBe(201);
    await request(app)
      .post(`/api/sessions/${customSession.body.id}/review`)
      .send({ answer: "A transaction is atomic." });
    expect(provider.calls[0].messages[0].content).toContain("Custom review instructions");

    await request(app)
      .post(`/api/sessions/${beforeArchive.body.id}/review`)
      .send({ answer: "A transaction is atomic." });
    expect(provider.calls[1].messages[0].content).toContain("Archived profile review instructions");
  });

  it("runs a sequential multi-question exam", async () => {
    const multiQuestionExam: ExamPackage = {
      ...exam,
      questions: Array.from({ length: 6 }, (_, index) => ({
        ...exam.questions[0],
        id: `q-${index + 1}`,
        officialNumber: index + 1,
        officialText: `Question ${index + 1}`,
        displayText: `Question ${index + 1}`,
      })),
    };
    const provider = new SequenceProvider([finalReview, finalReview, finalReview]);
    const app = createApp({
      database,
      exams: [multiQuestionExam],
      aiProvider: provider,
      random: () => 0,
    });

    expect((await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 4,
    })).status).toBe(400);

    const created = await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 3,
    });
    expect(created.status).toBe(201);
    expect(new Set(created.body.run.items.map((item: { questionId: string }) => item.questionId)).size)
      .toBe(3);
    expect(created.body.session.mode).toBe("exam");
    expect((await request(app).post(`/api/exam-runs/${created.body.run.id}/next`)).status)
      .toBe(409);

    let sessionId = created.body.session.id as string;
    for (let position = 1; position <= 3; position += 1) {
      const reviewed = await request(app)
        .post(`/api/sessions/${sessionId}/review`)
        .send({ answer: `Complete answer ${position}` });
      expect(reviewed.status).toBe(200);

      const next = await request(app).post(`/api/exam-runs/${created.body.run.id}/next`);
      expect(next.status).toBe(200);
      if (position < 3) {
        expect(next.body.run.currentPosition).toBe(position + 1);
        sessionId = next.body.session.id;
      } else {
        expect(next.body.summary).toMatchObject({ averageScore: 84, ready: 3 });
      }
    }
  });

  it("forces final review immediately for exam sessions", async () => {
    const provider = new SequenceProvider([finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const created = await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 1,
    });

    const response = await request(app)
      .post(`/api/sessions/${created.body.session.id}/review`)
      .send({ answer: "A transaction is atomic." });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].forceFinal).toBe(true);
    expect(provider.calls[0].messages[0].content).toContain("exam_final");
  });

  it("groups completed exam runs and returns ordered exam history details", async () => {
    const multiQuestionExam: ExamPackage = {
      ...exam,
      questions: Array.from({ length: 3 }, (_, index) => ({
        ...exam.questions[0],
        id: `q-${index + 1}`,
        officialNumber: index + 1,
        officialText: `Official question ${index + 1}`,
        displayText: `Question ${index + 1}`,
      })),
    };
    const app = createApp({
      database,
      exams: [multiQuestionExam],
      aiProvider: new SequenceProvider([finalReview, finalReview, finalReview]),
      random: () => 0,
    });

    const studySession = await request(app).post("/api/sessions").send({
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      profileId: "neutral",
    });
    await request(app)
      .post(`/api/sessions/${studySession.body.id}/review`)
      .send({ answer: "Independent study answer" });

    const created = await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 2,
    });
    const runId = created.body.run.id as string;
    const answers = ["First exam answer", "Second exam answer"];
    let sessionId = created.body.session.id as string;
    for (const answer of answers) {
      await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer });
      const next = await request(app).post(`/api/exam-runs/${runId}/next`);
      sessionId = next.body.session?.id;
    }

    const history = await request(app).get("/api/history");
    expect(history.status).toBe(200);
    expect(history.body.examRuns).toEqual([
      expect.objectContaining({
        runId,
        examId: "exam",
        examTitle: "Database exam",
        questionCount: 2,
        averageScore: 84,
        totalXp: 40,
      }),
    ]);
    expect(history.body.studyAttempts).toHaveLength(1);
    expect(history.body.studyAttempts[0]).toMatchObject({
      sessionId: studySession.body.id,
      answer: "Independent study answer",
      review: { action: "final", examinerMessage: finalReview.examinerMessage },
    });

    const detail = await request(app).get(`/api/history/exams/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.summary).toMatchObject({ runId, averageScore: 84, totalXp: 40 });
    expect(detail.body.items).toEqual([
      expect.objectContaining({
        position: 1,
        questionId: "q-1",
        questionTitle: "Question 1",
        officialText: "Official question 1",
        answer: "First exam answer",
        baseScore: 84,
        xp: 20,
        review: expect.objectContaining({ action: "final", examinerMessage: finalReview.examinerMessage }),
      }),
      expect.objectContaining({
        position: 2,
        questionId: "q-2",
        questionTitle: "Question 2",
        answer: "Second exam answer",
      }),
    ]);
  });

  it("deletes an active exam run with all linked session data", async () => {
    const multiQuestionExam: ExamPackage = {
      ...exam,
      questions: [
        exam.questions[0],
        { ...exam.questions[0], id: "q-2", officialNumber: 2, displayText: "Question 2" },
      ],
    };
    const app = createApp({
      database,
      exams: [multiQuestionExam],
      aiProvider: new SequenceProvider([finalReview]),
      random: () => 0,
    });
    const created = await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 2,
    });
    const runId = created.body.run.id as string;
    const firstSessionId = created.body.session.id as string;
    await request(app)
      .post(`/api/sessions/${firstSessionId}/review`)
      .send({ answer: "Completed first answer" });
    const next = await request(app).post(`/api/exam-runs/${runId}/next`);
    const secondSessionId = next.body.session.id as string;

    const cancelled = await request(app).delete(`/api/exam-runs/${runId}`);

    expect(cancelled.status).toBe(204);
    expect(database.prepare("SELECT COUNT(*) AS count FROM exam_runs WHERE id = ?").get(runId))
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id IN (?, ?)").get(firstSessionId, secondSessionId))
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM attempts WHERE session_id = ?").get(firstSessionId))
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM reviews WHERE session_id = ?").get(firstSessionId))
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM messages WHERE session_id = ?").get(firstSessionId))
      .toEqual({ count: 0 });
  });

  it("rejects deletion of a completed exam run", async () => {
    const app = createApp({
      database,
      exams: [exam],
      aiProvider: new SequenceProvider([finalReview]),
    });
    const created = await request(app).post("/api/exam-runs").send({
      examId: "exam",
      profileId: "neutral",
      questionCount: 1,
    });
    const runId = created.body.run.id as string;
    await request(app)
      .post(`/api/sessions/${created.body.session.id}/review`)
      .send({ answer: "Completed answer" });

    const rejected = await request(app).delete(`/api/exam-runs/${runId}`);

    expect(rejected.status).toBe(409);
    expect(database.prepare("SELECT status FROM exam_runs WHERE id = ?").get(runId))
      .toEqual({ status: "completed" });
  });

  it("supports exam discovery, notes, bookmarks, sessions, review, and history", async () => {
    const provider = new SequenceProvider([finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });

    expect((await request(app).get("/api/exams")).body[0].questionCount).toBe(1);
    expect((await request(app).get("/api/exams/exam/questions/q-1")).status).toBe(200);
    expect(
      (await request(app).put("/api/questions/q-1/note").send({ note: "Review ACID" }))
        .body.note,
    ).toBe("Review ACID");
    expect(
      (
        await request(app)
          .put("/api/questions/q-1/bookmark")
          .send({ bookmarked: true })
      ).body.bookmarked,
    ).toBe(true);

    const sessionId = await createSession(app);
    expect(
      (
        await request(app)
          .post(`/api/sessions/${sessionId}/messages`)
          .send({ content: "A transaction is atomic." })
      ).status,
    ).toBe(201);
    const review = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "A transaction is atomic." });

    expect(review.status).toBe(200);
    expect(review.body.baseScore).toBe(84);
    expect(review.body.xp).toBe(20);
    const history = await request(app).get("/api/history");
    expect(history.body.studyAttempts).toHaveLength(1);
    expect(history.body.studyAttempts[0].baseScore).toBe(84);
    expect(history.body.studyAttempts[0].questionTitle).toBe("What is a transaction?");
  });

  it("returns document metadata without the full document unless a page is requested", async () => {
    const app = createApp({ database, exams: [exam], aiProvider: null });

    const metadata = await request(app).get("/api/exams/exam/documents/book");
    const page = await request(app).get("/api/exams/exam/documents/book?page=1");

    expect(metadata.status).toBe(200);
    expect(metadata.body.fragments).toBeUndefined();
    expect(page.body.fragments).toHaveLength(1);
  });

  it("lists and serves files from the materials directory", async () => {
    const materialsDir = await mkdtemp(join(tmpdir(), "virtex-materials-"));
    await writeFile(join(materialsDir, "guide.pdf"), Buffer.from("%PDF guide"));
    await writeFile(join(materialsDir, "terms.txt"), "transaction glossary");
    const app = createApp({ database, exams: [exam], aiProvider: null, materialsDir });

    const listed = await request(app).get("/api/materials");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        name: "guide.pdf",
        size: 10,
        url: "/materials/guide.pdf",
      }),
      expect.objectContaining({
        name: "terms.txt",
        size: 20,
        url: "/materials/terms.txt",
      }),
    ]);

    const opened = await request(app).get("/materials/terms.txt");
    expect(opened.status).toBe(200);
    expect(opened.text).toBe("transaction glossary");
  });

  it("retries invalid AI JSON once", async () => {
    const provider = new SequenceProvider([{ invalid: true }, finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Atomic unit." });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].repair).toBe(true);
  });

  it("accepts a fenced JSON AI review response", async () => {
    const provider = new SequenceProvider([
      `Here is the review:\n\`\`\`json\n${JSON.stringify(finalReview)}\n\`\`\``,
    ]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Atomic unit." });

    expect(response.status).toBe(200);
    expect(response.body.action).toBe("final");
    expect(provider.calls).toHaveLength(1);
  });

  it("accepts strict-schema nulls for optional clarification fields", async () => {
    const clarification = {
      action: "clarify",
      examinerMessage: "What is atomicity?",
      baseScore: null,
      personaVerdict: "Needs clarification",
      strengths: [],
      gaps: ["Atomicity"],
      errors: [],
      citations: [
        { documentId: "book", page: 1, fragmentId: null, note: null },
      ],
      advice: "Answer the focused question.",
    };
    const provider = new SequenceProvider([clarification]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "A transaction groups work." });

    expect(response.status).toBe(200);
    expect(response.body.action).toBe("clarify");
    expect(response.body.baseScore).toBeUndefined();
  });

  it("retries a review that cites a source not linked to the question", async () => {
    const unsupportedCitation = {
      ...finalReview,
      citations: [{ documentId: "other-book", page: 99 }],
    };
    const provider = new SequenceProvider([unsupportedCitation, finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Atomic unit." });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].repair).toBe(true);
  });

  it("does not assign a score after two invalid AI responses", async () => {
    const provider = new SequenceProvider([{ invalid: true }, "still invalid"]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Atomic unit." });

    expect(response.status).toBe(502);
    expect(response.body.baseScore).toBeUndefined();
  });

  it("forces a final review after two clarification turns", async () => {
    const clarification = {
      ...finalReview,
      action: "clarify",
      baseScore: undefined,
      examinerMessage: "What does isolation mean?",
    };
    const provider = new SequenceProvider([clarification, clarification, finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "First" });
    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "Second" });
    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Third" });

    expect(response.status).toBe(200);
    expect(provider.calls.map((call) => call.forceFinal)).toEqual([false, false, true]);
    expect(response.body.action).toBe("final");
  });

  it("does not accept another clarification when the server requires a final verdict", async () => {
    const clarification = {
      ...finalReview,
      action: "clarify",
      baseScore: undefined,
      examinerMessage: "One more question",
    };
    const provider = new SequenceProvider([
      clarification,
      clarification,
      clarification,
      clarification,
    ]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "First" });
    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "Second" });
    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Third" });

    expect(response.status).toBe(502);
    expect(response.body.baseScore).toBeUndefined();
  });

  it("aligns history reviews with attempts and excludes clarification-only reviews", async () => {
    const clarification = {
      ...finalReview,
      action: "clarify",
      baseScore: undefined,
      examinerMessage: "What is atomicity?",
    };
    const provider = new SequenceProvider([clarification, finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "First" });
    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "Second" });
    const history = await request(app).get("/api/history");

    expect(history.body.studyAttempts).toHaveLength(1);
    expect(history.body.studyAttempts[0].review.action).toBe("final");
  });

  it("rejects another review after a session has completed", async () => {
    const provider = new SequenceProvider([finalReview, finalReview]);
    const app = createApp({ database, exams: [exam], aiProvider: provider });
    const sessionId = await createSession(app);

    await request(app).post(`/api/sessions/${sessionId}/review`).send({ answer: "First" });
    const repeated = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Second" });

    expect(repeated.status).toBe(409);
    expect(provider.calls).toHaveLength(1);
  });

  it("keeps the session untouched when AI is unavailable", async () => {
    const app = createApp({ database, exams: [exam], aiProvider: null });
    const sessionId = await createSession(app);
    const response = await request(app)
      .post(`/api/sessions/${sessionId}/review`)
      .send({ answer: "Offline draft" });

    expect(response.status).toBe(503);
    const messages = database.prepare("SELECT COUNT(*) AS count FROM messages WHERE session_id = ?")
      .get(sessionId) as { count: number };
    const session = database.prepare("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as { status: string };
    expect(messages.count).toBe(0);
    expect(session.status).toBe("active");
  });
});

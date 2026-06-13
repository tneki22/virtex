import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamPackage } from "../../shared/contracts.js";
import { createApp } from "../../server/app.js";
import type { AIProvider, ReviewProviderInput } from "../../server/ai.js";
import { createDatabase } from "../../server/database.js";

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

  constructor(private readonly responses: unknown[]) {}

  async review(input: ReviewProviderInput): Promise<unknown> {
    this.calls.push(input);
    return this.responses.shift();
  }

  async chat() {
    return "Tutor response";
  }

  async testConnection() {
    return { ok: true, model: this.model };
  }
}

async function createSession(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/api/sessions").send({
    examId: "exam",
    questionId: "q-1",
    mode: "exam",
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
    const app = createApp({
      database,
      exams: [exam],
      aiProvider: null,
      speechProvider: { model: "whisper", transcribe: vi.fn() },
    });
    expect((await request(app).get("/api/settings/status")).body).toEqual({
      aiConfigured: false,
      speechConfigured: true,
    });
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
    expect(history.body.attempts).toHaveLength(1);
    expect(history.body.attempts[0].baseScore).toBe(84);
    expect(history.body.attempts[0].questionTitle).toBe("What is a transaction?");
  });

  it("returns document metadata without the full document unless a page is requested", async () => {
    const app = createApp({ database, exams: [exam], aiProvider: null });

    const metadata = await request(app).get("/api/exams/exam/documents/book");
    const page = await request(app).get("/api/exams/exam/documents/book?page=1");

    expect(metadata.status).toBe(200);
    expect(metadata.body.fragments).toBeUndefined();
    expect(page.body.fragments).toHaveLength(1);
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

    expect(history.body.attempts).toHaveLength(1);
    expect(history.body.reviews).toHaveLength(1);
    expect(history.body.reviews[0].action).toBe("final");
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

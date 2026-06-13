import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import express from "express";
import { z } from "zod";
import type {
  AIReview,
  ExamPackage,
  ExamQuestion,
  SessionMessage,
  StudyMode,
} from "../shared/contracts.js";
import { calculateXp, readinessFromScore } from "../shared/progress.js";
import { aiReviewContentSchema } from "../shared/schemas.js";
import type { AIProvider } from "./ai.js";
import { guardInstructionOnlyAnswer } from "./answer-guard.js";
import {
  buildReviewRequest,
  PROMPT_VERSION,
  REVIEW_SCHEMA_VERSION,
} from "./prompt.js";

interface CreateAppOptions {
  database: Database.Database;
  exams: ExamPackage[];
  aiProvider: AIProvider | null;
  now?: () => Date;
  random?: () => number;
}

interface SessionRow {
  id: string;
  exam_id: string;
  question_id: string;
  mode: StudyMode;
  profile_id: string;
  status: "active" | "completed";
  follow_up_count: number;
  created_at: string;
  completed_at: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

function sessionFromRow(row: SessionRow) {
  return {
    id: row.id,
    examId: row.exam_id,
    questionId: row.question_id,
    mode: row.mode,
    profileId: row.profile_id,
    status: row.status,
    followUpCount: row.follow_up_count,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function validateProviderResponse(
  value: unknown,
  question: ExamQuestion,
  forceFinal: boolean,
) {
  let parsed: ReturnType<typeof aiReviewContentSchema.safeParse>;
  if (typeof value !== "string") parsed = aiReviewContentSchema.safeParse(value);
  else {
    try {
      parsed = aiReviewContentSchema.safeParse(JSON.parse(value));
    } catch {
      parsed = aiReviewContentSchema.safeParse(value);
    }
  }
  if (!parsed.success) return parsed;

  const review = parsed.data;
  const validAction =
    review.action !== "unavailable" &&
    (!forceFinal || review.action === "final") &&
    (review.action !== "final" || review.baseScore !== undefined) &&
    (review.action !== "clarify" || review.baseScore === undefined);
  const validCitations = review.citations.every((citation) =>
    question.sources.some(
      (source) =>
        source.documentId === citation.documentId &&
        source.page === citation.page &&
        (!citation.fragmentId || source.fragmentId === citation.fragmentId),
    ),
  );

  return validAction && validCitations ? parsed : { success: false as const };
}

export function createApp(options: CreateAppOptions) {
  const app = express();
  const { database, aiProvider } = options;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const examMap = new Map(options.exams.map((exam) => [exam.id, exam]));

  app.use(express.json({ limit: "1mb" }));

  function timestamp() {
    return now().toISOString();
  }

  function findQuestion(questionId: string): { exam: ExamPackage; question: ExamQuestion } {
    for (const exam of options.exams) {
      const question = exam.questions.find((candidate) => candidate.id === questionId);
      if (question) return { exam, question };
    }
    throw Object.assign(new Error(`Question ${questionId} not found`), { status: 404 });
  }

  function getSession(sessionId: string): SessionRow {
    const session = database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as SessionRow | undefined;
    if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
    return session;
  }

  function insertMessage(sessionId: string, role: MessageRow["role"], content: string) {
    const message = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      createdAt: timestamp(),
    };
    database
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt);
    return message;
  }

  function persistReview(
    session: SessionRow,
    review: AIReview,
    answer: string,
    completed: boolean,
    awardXp = true,
  ) {
    let attemptId: string | null = null;
    let xp = 0;
    if (completed) {
      attemptId = randomUUID();
      xp = awardXp ? calculateXp({
        submitted: true,
        followUpsAnswered: session.follow_up_count,
        score: review.baseScore,
      }) : 0;
      database
        .prepare(
          `INSERT INTO attempts
            (id, session_id, question_id, answer, base_score, xp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attemptId,
          session.id,
          session.question_id,
          answer,
          review.baseScore ?? null,
          xp,
          timestamp(),
        );
      database
        .prepare("UPDATE sessions SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(timestamp(), session.id);
    }

    database
      .prepare(
        `INSERT INTO reviews
          (id, attempt_id, session_id, action, payload_json, model, package_version,
           prompt_version, schema_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        attemptId,
        session.id,
        review.action,
        JSON.stringify(review),
        review.model ?? null,
        review.packageVersion,
        review.promptVersion,
        review.schemaVersion,
        timestamp(),
      );
    return xp;
  }

  app.get("/api/exams", (_request, response) => {
    const scoreRows = database
      .prepare(
        "SELECT question_id, MAX(base_score) AS best_score FROM attempts GROUP BY question_id",
      )
      .all() as Array<{ question_id: string; best_score: number | null }>;
    const scores = new Map(scoreRows.map((row) => [row.question_id, row.best_score]));

    response.json(
      options.exams.map((exam) => ({
        id: exam.id,
        version: exam.version,
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        questionCount: exam.questions.length,
        readyCount: exam.questions.filter(
          (question) => readinessFromScore(scores.get(question.id) ?? undefined) === "ready",
        ).length,
      })),
    );
  });

  app.get("/api/exams/:id", (request, response) => {
    const exam = examMap.get(request.params.id);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    response.json({
      ...exam,
      documents: exam.documents.map(({ fragments: _fragments, ...document }) => document),
      questions: exam.questions.map(({ referenceAnswer: _answer, ...question }) => question),
    });
  });

  app.get("/api/exams/:id/questions/:questionId", (request, response) => {
    const exam = examMap.get(request.params.id);
    const question = exam?.questions.find(
      (candidate) => candidate.id === request.params.questionId,
    );
    if (!exam || !question) return response.status(404).json({ error: "Question not found" });

    const note = database
      .prepare("SELECT note FROM notes WHERE question_id = ?")
      .get(question.id) as { note: string } | undefined;
    const bookmark = database
      .prepare("SELECT bookmarked FROM bookmarks WHERE question_id = ?")
      .get(question.id) as { bookmarked: number } | undefined;
    const attempts = database
      .prepare(
        "SELECT COUNT(*) AS count, MAX(base_score) AS best_score FROM attempts WHERE question_id = ?",
      )
      .get(question.id) as { count: number; best_score: number | null };

    response.json({
      ...question,
      note: note?.note ?? "",
      bookmarked: bookmark?.bookmarked === 1,
      progress: {
        attempts: attempts.count,
        bestScore: attempts.best_score ?? undefined,
        readiness: readinessFromScore(attempts.best_score ?? undefined),
      },
    });
  });

  app.get("/api/exams/:id/documents/:documentId", (request, response) => {
    const exam = examMap.get(request.params.id);
    const document = exam?.documents.find(
      (candidate) => candidate.id === request.params.documentId,
    );
    if (!exam || !document) return response.status(404).json({ error: "Document not found" });
    const page = request.query.page === undefined ? undefined : Number(request.query.page);
    const { fragments: _fragments, ...metadata } = document;
    if (page === undefined) return response.json(metadata);
    if (!Number.isInteger(page) || page < 1 || page > (document.pageCount ?? 0)) {
      return response.status(400).json({ error: "Invalid document page" });
    }
    response.json({
      ...metadata,
      fragments: (document.fragments ?? []).filter((fragment) => fragment.page === page),
    });
  });

  app.post("/api/sessions", (request, response) => {
    const body = z
      .object({
        examId: z.string(),
        questionId: z.string().optional(),
        mode: z.enum(["study", "practice", "exam"]),
        profileId: z.string(),
      })
      .parse(request.body);
    const exam = examMap.get(body.examId);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    const question = body.questionId
      ? exam.questions.find((candidate) => candidate.id === body.questionId)
      : exam.questions[Math.floor(random() * exam.questions.length)];
    if (!question) return response.status(404).json({ error: "Question not found" });
    if (!exam.profiles.some((profile) => profile.id === body.profileId)) {
      return response.status(400).json({ error: "Profile not found" });
    }

    const session = {
      id: randomUUID(),
      examId: exam.id,
      questionId: question.id,
      mode: body.mode,
      profileId: body.profileId,
      status: "active" as const,
      followUpCount: 0,
      createdAt: timestamp(),
    };
    database
      .prepare(
        `INSERT INTO sessions
          (id, exam_id, question_id, mode, profile_id, status, follow_up_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.examId,
        session.questionId,
        session.mode,
        session.profileId,
        session.status,
        session.followUpCount,
        session.createdAt,
      );
    response.status(201).json(session);
  });

  app.post("/api/sessions/:id/messages", (request, response) => {
    getSession(request.params.id);
    const { content } = z.object({ content: z.string().min(1) }).parse(request.body);
    response.status(201).json(insertMessage(request.params.id, "user", content));
  });

  app.post("/api/sessions/:id/review", async (request, response) => {
    const session = getSession(request.params.id);
    if (session.status === "completed") {
      return response.status(409).json({ error: "Session is already completed" });
    }
    const { answer } = z
      .object({ answer: z.string().trim().min(1).max(8_000) })
      .parse(request.body);
    const exam = examMap.get(session.exam_id);
    const question = exam?.questions.find((candidate) => candidate.id === session.question_id);
    const profile = exam?.profiles.find((candidate) => candidate.id === session.profile_id);
    if (!exam || !question || !profile) {
      return response.status(409).json({ error: "Session content is unavailable" });
    }

    insertMessage(session.id, "user", answer);
    const dialogueRows = database
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, rowid")
      .all(session.id) as MessageRow[];
    const dialogue: SessionMessage[] = dialogueRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));

    if (!aiProvider) {
      const review: AIReview = {
        action: "unavailable",
        examinerMessage: "AI-проверка недоступна. Черновик сохранён без оценки.",
        personaVerdict: "Оценка не выставлена.",
        strengths: [],
        gaps: [],
        errors: [],
        citations: [],
        advice: "Продолжите изучение по эталону и источникам.",
        packageVersion: exam.version,
        promptVersion: PROMPT_VERSION,
        schemaVersion: REVIEW_SCHEMA_VERSION,
      };
      const xp = persistReview(session, review, answer, true);
      return response.json({ ...review, xp });
    }

    const guardedContent = guardInstructionOnlyAnswer(answer, question);
    if (guardedContent) {
      const review: AIReview = {
        ...guardedContent,
        model: "local-answer-guard",
        packageVersion: exam.version,
        promptVersion: PROMPT_VERSION,
        schemaVersion: REVIEW_SCHEMA_VERSION,
      };
      insertMessage(session.id, "assistant", review.examinerMessage);
      const xp = persistReview(session, review, answer, true, false);
      return response.json({ ...review, xp });
    }

    const requestInput = buildReviewRequest({
      exam,
      question,
      profile,
      answer,
      dialogue,
      forceFinal: session.follow_up_count >= exam.policy.maxFollowUps,
    });
    let parsed = validateProviderResponse(
      await aiProvider.review(requestInput),
      question,
      requestInput.forceFinal,
    );
    if (!parsed.success) {
      parsed = validateProviderResponse(
        await aiProvider.review({ ...requestInput, repair: true }),
        question,
        requestInput.forceFinal,
      );
    }
    if (!parsed.success) {
      return response.status(502).json({
        action: "unavailable",
        examinerMessage: "AI returned an invalid response twice.",
        error: "invalid_ai_response",
      });
    }

    const review: AIReview = {
      ...parsed.data,
      model: aiProvider.model,
      packageVersion: exam.version,
      promptVersion: PROMPT_VERSION,
      schemaVersion: REVIEW_SCHEMA_VERSION,
    };
    const completed = review.action === "final";
    if (!completed) {
      database
        .prepare("UPDATE sessions SET follow_up_count = follow_up_count + 1 WHERE id = ?")
        .run(session.id);
    }
    insertMessage(session.id, "assistant", review.examinerMessage);
    const xp = persistReview(session, review, answer, completed);
    response.json({ ...review, xp });
  });

  app.put("/api/questions/:id/note", (request, response) => {
    findQuestion(request.params.id);
    const { note } = z.object({ note: z.string() }).parse(request.body);
    database
      .prepare(
        `INSERT INTO notes (question_id, note, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(request.params.id, note, timestamp());
    response.json({ questionId: request.params.id, note });
  });

  app.put("/api/questions/:id/bookmark", (request, response) => {
    findQuestion(request.params.id);
    const { bookmarked } = z.object({ bookmarked: z.boolean() }).parse(request.body);
    database
      .prepare(
        `INSERT INTO bookmarks (question_id, bookmarked, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET bookmarked = excluded.bookmarked, updated_at = excluded.updated_at`,
      )
      .run(request.params.id, bookmarked ? 1 : 0, timestamp());
    response.json({ questionId: request.params.id, bookmarked });
  });

  app.get("/api/history", (_request, response) => {
    const rows = database
      .prepare(
        `SELECT attempts.*, reviews.payload_json
         FROM attempts
         JOIN reviews ON reviews.attempt_id = attempts.id
         ORDER BY attempts.created_at DESC, attempts.rowid DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const attempts = rows.map((item) => {
        const locatedQuestion = findQuestion(String(item.question_id));
        return {
          id: item.id,
          sessionId: item.session_id,
          questionId: item.question_id,
          examId: locatedQuestion.exam.id,
          questionTitle: locatedQuestion.question.displayText,
          answer: item.answer,
          baseScore: item.base_score ?? undefined,
          xp: item.xp,
          createdAt: item.created_at,
        };
      });
    const reviews = rows.map((row) => JSON.parse(String(row.payload_json)));
    response.json({ attempts, reviews });
  });

  app.post("/api/settings/ai/test", async (_request, response) => {
    if (!aiProvider) {
      return response.status(503).json({ ok: false, message: "AI is not configured" });
    }
    const result = await aiProvider.testConnection();
    response.status(result.ok ? 200 : 502).json(result);
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: "Invalid request", issues: error.issues });
    }
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 500;
    response.status(status).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  return app;
}

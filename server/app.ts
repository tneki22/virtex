import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type Database from "better-sqlite3";
import express from "express";
import multer from "multer";
import { z } from "zod";
import type {
  AIReview,
  ExamHistoryDetail,
  ExamHistorySummary,
  ExamPackage,
  ExamQuestion,
  HistoryData,
  SessionKind,
  SessionMessage,
  StudyAttemptHistoryEntry,
  StudySession,
} from "../shared/contracts.js";
import { calculateExamRunSummary, selectQuestionIds } from "../shared/exam-run.js";
import { calculateXp, readinessFromScore } from "../shared/progress.js";
import {
  aiReviewContentSchema,
  examQuestionCountSchema,
  studyModeSchema,
} from "../shared/schemas.js";
import { normalizeStudyMode } from "../shared/study-mode.js";
import type { AIProvider } from "./ai.js";
import { guardInstructionOnlyAnswer } from "./answer-guard.js";
import {
  activateNextRunItem,
  attachSessionToRunItem,
  cancelExamRun,
  completeRunItem,
  createExamRun,
  getExamRun,
} from "./exam-runs.js";
import {
  buildReviewRequest,
  buildTutorRequest,
  PROMPT_VERSION,
  REVIEW_SCHEMA_VERSION,
} from "./prompt.js";
import type { SpeechTranscriptionProvider } from "./transcription.js";
import type { RuntimeAIService } from "./runtime-ai.js";
import { RuntimePromptService } from "./runtime-prompts.js";

interface CreateAppOptions {
  database: Database.Database;
  exams: ExamPackage[];
  runtimeAI?: RuntimeAIService;
  runtimePrompts?: RuntimePromptService;
  aiProvider?: AIProvider | null;
  speechProvider?: SpeechTranscriptionProvider | null;
  now?: () => Date;
  random?: () => number;
  materialsDir?: string;
}

interface SessionRow {
  id: string;
  exam_id: string;
  question_id: string;
  mode: string;
  kind: SessionKind;
  title: string;
  profile_id: string;
  status: "active" | "completed";
  follow_up_count: number;
  created_at: string;
  updated_at: string;
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
    mode: normalizeStudyMode(row.mode),
    kind: row.kind,
    title: row.title,
    profileId: row.profile_id,
    status: row.status,
    followUpCount: row.follow_up_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    const json = parseJsonCandidate(value);
    parsed = json.success
      ? aiReviewContentSchema.safeParse(json.data)
      : aiReviewContentSchema.safeParse(value);
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

function parseJsonCandidate(value: string): { success: true; data: unknown } | { success: false } {
  const trimmed = value.trim();
  for (const candidate of jsonCandidates(trimmed)) {
    try {
      return { success: true, data: JSON.parse(candidate) };
    } catch {
      continue;
    }
  }
  return { success: false };
}

function jsonCandidates(value: string): string[] {
  const candidates = [value];
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const object = extractFirstJsonObject(value);
  if (object) candidates.push(object);
  return candidates;
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

export function createApp(options: CreateAppOptions) {
  const app = express();
  const { database } = options;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const examMap = new Map(options.exams.map((exam) => [exam.id, exam]));
  const materialsDir = resolve(options.materialsDir ?? "materials");
  const runtimePrompts = options.runtimePrompts ?? new RuntimePromptService({ database });

  function currentAIProvider() {
    return options.runtimeAI?.getTextProvider() ?? options.aiProvider ?? null;
  }

  function currentSpeechProvider() {
    return options.runtimeAI?.getSpeechProvider() ?? options.speechProvider ?? null;
  }

  app.use(express.json({ limit: "1mb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      const mimeType = file.mimetype.split(";")[0];
      callback(null, [
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp4",
      ].includes(mimeType));
    },
  });

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

  function activeProfiles(exam: ExamPackage) {
    return runtimePrompts.activeProfiles(exam);
  }

  function profileIsActive(exam: ExamPackage, profileId: string) {
    return activeProfiles(exam).some((profile) => profile.id === profileId);
  }

  function resolveProfile(exam: ExamPackage, profileId: string) {
    return runtimePrompts.resolveProfile(exam, profileId);
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

  function messagesForSession(sessionId: string): SessionMessage[] {
    const rows = database
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, rowid")
      .all(sessionId) as MessageRow[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  function reviewsForSession(sessionId: string): AIReview[] {
    const rows = database
      .prepare("SELECT payload_json FROM reviews WHERE session_id = ? ORDER BY created_at, rowid")
      .all(sessionId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as AIReview);
  }

  function chatDetail(row: SessionRow) {
    return {
      ...sessionFromRow(row),
      messages: messagesForSession(row.id),
      reviews: reviewsForSession(row.id),
    };
  }

  function titleFromMessage(content: string) {
    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized.length <= 64 ? normalized : `${normalized.slice(0, 61).trimEnd()}…`;
  }

  function touchSession(sessionId: string, content?: string) {
    const current = getSession(sessionId);
    const defaultTitle = current.kind === "tutor" ? "Разбор темы" : "Проверка ответа";
    const title = content && current.title === defaultTitle
      ? titleFromMessage(content)
      : current.title;
    const updatedAt = timestamp();
    database.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, updatedAt, sessionId);
    return { title, updatedAt };
  }

  async function listMaterialFiles() {
    let entries;
    try {
      entries = await readdir(materialsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = resolve(materialsDir, entry.name);
        const metadata = await stat(filePath);
        return {
          name: entry.name,
          size: metadata.size,
          url: `/materials/${encodeURIComponent(entry.name)}`,
        };
      }));
    return files.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }

  function createSessionRecord(input: {
    examId: string;
    questionId: string;
    mode: StudySession["mode"];
    kind?: SessionKind;
    title?: string;
    profileId: string;
  }): StudySession {
    const kind = input.kind ?? (input.mode === "exam" ? "exam" : "review");
    const title = input.title ?? (kind === "tutor" ? "Разбор темы" : kind === "exam" ? "Экзамен" : "Проверка ответа");
    const createdAt = timestamp();
    const session: StudySession = {
      id: randomUUID(),
      examId: input.examId,
      questionId: input.questionId,
      mode: input.mode,
      kind,
      title,
      profileId: input.profileId,
      status: "active",
      followUpCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    database.prepare(`
      INSERT INTO sessions
        (id, exam_id, question_id, mode, kind, title, profile_id, status, follow_up_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.examId,
      session.questionId,
      session.mode,
      session.kind,
      session.title,
      session.profileId,
      session.status,
      session.followUpCount,
      session.createdAt,
      session.updatedAt,
    );
    return session;
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
    if (completed) {
      completeRunItem(database, session.id, {
        ...(review.baseScore === undefined ? {} : { baseScore: review.baseScore }),
        xp,
        completedAt: timestamp(),
      });
    }
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

  app.get("/api/materials", async (_request, response) => {
    response.json(await listMaterialFiles());
  });

  app.get("/materials/:fileName", (request, response) => {
    const fileName = request.params.fileName;
    if (!fileName || fileName !== basename(fileName)) {
      return response.status(404).json({ error: "Material not found" });
    }
    const filePath = resolve(materialsDir, fileName);
    if (!filePath.startsWith(`${materialsDir}\\`) && !filePath.startsWith(`${materialsDir}/`)) {
      return response.status(404).json({ error: "Material not found" });
    }
    response.sendFile(filePath, (error) => {
      if (error && !response.headersSent) {
        response.status(404).json({ error: "Material not found" });
      }
    });
  });

  app.get("/api/exams/:id", (request, response) => {
    const exam = examMap.get(request.params.id);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    response.json({
      ...exam,
      profiles: activeProfiles(exam),
      documents: exam.documents.map(({ fragments: _fragments, ...document }) => document),
      questions: exam.questions.map(({ referenceAnswer: _answer, ...question }) => question),
    });
  });

  app.get("/api/exams/:id/prompts", (request, response) => {
    const exam = examMap.get(request.params.id);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    response.json(runtimePrompts.getSettings(exam));
  });

  app.put("/api/exams/:id/prompts", (request, response) => {
    const exam = examMap.get(request.params.id);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    response.json(runtimePrompts.updateSettings(exam, request.body));
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

  app.post("/api/exam-runs", (request, response) => {
    const body = z.object({
      examId: z.string().min(1),
      profileId: z.string().min(1),
      questionCount: examQuestionCountSchema,
    }).parse(request.body);
    const exam = examMap.get(body.examId);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    if (!profileIsActive(exam, body.profileId)) {
      return response.status(400).json({ error: "Profile not found" });
    }

    const questionIds = selectQuestionIds(
      exam.questions.map((question) => question.id),
      body.questionCount,
      random,
    );
    const run = createExamRun(database, {
      id: randomUUID(),
      examId: exam.id,
      profileId: body.profileId,
      questionIds,
      createdAt: timestamp(),
    });
    const activeItem = run.items.find((item) => item.status === "active")!;
    const session = createSessionRecord({
      examId: exam.id,
      questionId: activeItem.questionId,
      mode: "exam",
      profileId: body.profileId,
    });
    attachSessionToRunItem(database, run.id, activeItem.position, session.id);
    response.status(201).json({ run: getExamRun(database, run.id), session });
  });

  app.get("/api/exam-runs/:id", (request, response) => {
    const run = getExamRun(database, request.params.id);
    if (!run) return response.status(404).json({ error: "Exam run not found" });
    if (run.status === "completed") {
      const exam = examMap.get(run.examId)!;
      return response.json({
        run,
        summary: calculateExamRunSummary(run.items, exam.thresholds),
      });
    }
    const activeItem = run.items.find((item) => item.status === "active");
    const session = activeItem?.sessionId
      ? sessionFromRow(getSession(activeItem.sessionId))
      : undefined;
    response.json({ run, ...(session ? { session } : {}) });
  });

  app.delete("/api/exam-runs/:id", (request, response) => {
    const deleted = cancelExamRun(database, request.params.id);
    if (!deleted) return response.status(404).json({ error: "Exam run not found" });
    response.status(204).end();
  });

  app.post("/api/exam-runs/:id/next", (request, response) => {
    let run = getExamRun(database, request.params.id);
    if (!run) return response.status(404).json({ error: "Exam run not found" });
    const exam = examMap.get(run.examId);
    if (!exam) return response.status(409).json({ error: "Exam content is unavailable" });
    if (run.status === "completed") {
      return response.json({ run, summary: calculateExamRunSummary(run.items, exam.thresholds) });
    }

    let activeItem = run.items.find((item) => item.status === "active");
    if (activeItem?.sessionId) {
      return response.status(409).json({ error: "Current question is not completed" });
    }
    activeItem ??= activateNextRunItem(database, run.id);
    if (!activeItem) {
      run = getExamRun(database, run.id)!;
      return response.json({ run, summary: calculateExamRunSummary(run.items, exam.thresholds) });
    }

    const session = createSessionRecord({
      examId: run.examId,
      questionId: activeItem.questionId,
      mode: "exam",
      profileId: run.profileId,
    });
    attachSessionToRunItem(database, run.id, activeItem.position, session.id);
    response.json({ run: getExamRun(database, run.id), session });
  });

  app.post("/api/transcriptions", (request, response, next) => {
    const speechProvider = currentSpeechProvider();
    if (!speechProvider) {
      return response.status(503).json({ error: "Voice transcription is not configured" });
    }
    upload.single("audio")(request, response, (error) => {
      if (error) return next(error);
      void (async () => {
        if (!request.file) {
          return response.status(400).json({ error: "A supported audio file is required" });
        }
        const { questionId } = z.object({ questionId: z.string().min(1) }).parse(request.body);
        const { exam, question } = findQuestion(questionId);
        const prompt = [
          exam.subject,
          `Вопрос: ${question.displayText}`,
          question.emphasis.length > 0 ? `Ключевые термины: ${question.emphasis.join(", ")}` : "",
        ].filter(Boolean).join(". ");
        try {
          const result = await speechProvider.transcribe({
            buffer: request.file.buffer,
            fileName: request.file.originalname || "answer.webm",
            mimeType: request.file.mimetype,
            prompt,
          });
          const provider = options.runtimeAI?.getState().speech.provider;
          response.json({ ...result, ...(provider && provider !== "disabled" ? { provider } : {}) });
        } catch {
          response.status(502).json({ error: "Voice transcription failed" });
        }
      })().catch(next);
    });
  });

  app.post("/api/sessions", (request, response) => {
    const body = z
      .object({
        examId: z.string(),
        questionId: z.string().optional(),
        mode: studyModeSchema,
        profileId: z.string(),
      })
      .parse(request.body);
    const exam = examMap.get(body.examId);
    if (!exam) return response.status(404).json({ error: "Exam not found" });
    const question = body.questionId
      ? exam.questions.find((candidate) => candidate.id === body.questionId)
      : exam.questions[Math.floor(random() * exam.questions.length)];
    if (!question) return response.status(404).json({ error: "Question not found" });
    if (!profileIsActive(exam, body.profileId)) {
      return response.status(400).json({ error: "Profile not found" });
    }

    const session = createSessionRecord({
      examId: exam.id,
      questionId: question.id,
      mode: body.mode,
      profileId: body.profileId,
    });
    response.status(201).json(session);
  });

  app.get("/api/exams/:examId/questions/:questionId/chats", (request, response) => {
    const exam = examMap.get(request.params.examId);
    const question = exam?.questions.find((item) => item.id === request.params.questionId);
    if (!exam || !question) return response.status(404).json({ error: "Question not found" });
    const rows = database.prepare(`
      SELECT sessions.*,
        (SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id) AS message_count,
        (SELECT content FROM messages WHERE messages.session_id = sessions.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS latest_message,
        (SELECT payload_json FROM reviews WHERE reviews.session_id = sessions.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS latest_review
      FROM sessions
      WHERE exam_id = ? AND question_id = ? AND kind IN ('tutor', 'review')
      ORDER BY updated_at DESC, created_at DESC
    `).all(exam.id, question.id) as Array<SessionRow & {
      message_count: number;
      latest_message: string | null;
      latest_review: string | null;
    }>;
    response.json(rows.map((row) => ({
      ...sessionFromRow(row),
      messageCount: row.message_count,
      ...(row.latest_message ? { latestMessage: row.latest_message } : {}),
      ...(row.latest_review ? { latestReview: JSON.parse(row.latest_review) } : {}),
    })));
  });

  app.post("/api/exams/:examId/questions/:questionId/chats", (request, response) => {
    const exam = examMap.get(request.params.examId);
    const question = exam?.questions.find((item) => item.id === request.params.questionId);
    if (!exam || !question) return response.status(404).json({ error: "Question not found" });
    const body = z.object({
      kind: z.enum(["tutor", "review"]),
      profileId: z.string().min(1),
    }).parse(request.body);
    if (!profileIsActive(exam, body.profileId)) {
      return response.status(400).json({ error: "Profile not found" });
    }
    const session = createSessionRecord({
      examId: exam.id,
      questionId: question.id,
      mode: "study",
      kind: body.kind,
      profileId: body.profileId,
    });
    response.status(201).json({ ...session, messages: [], reviews: [] });
  });

  app.get("/api/chats/:id", (request, response) => {
    const session = getSession(request.params.id);
    if (session.kind === "exam") return response.status(409).json({ error: "Exam sessions are not study chats" });
    response.json(chatDetail(session));
  });

  app.post("/api/chats/:id/messages/stream", async (request, response) => {
    const session = getSession(request.params.id);
    if (session.kind !== "tutor") return response.status(409).json({ error: "This chat does not accept tutor messages" });
    if (session.status === "completed") return response.status(409).json({ error: "Chat is completed" });
    const { content } = z.object({ content: z.string().trim().min(1).max(8_000) }).parse(request.body);
    const exam = examMap.get(session.exam_id);
    const question = exam?.questions.find((item) => item.id === session.question_id);
    const profile = exam ? resolveProfile(exam, session.profile_id) : undefined;
    if (!exam || !question || !profile) return response.status(409).json({ error: "Chat content is unavailable" });
    const aiProvider = currentAIProvider();
    if (!aiProvider) return response.status(503).json({ error: "AI tutor is not configured" });

    response.status(200);
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");

    const writeEvent = (event: Record<string, unknown>) => {
      response.write(`${JSON.stringify(event)}\n`);
    };

    let assistantContent = "";
    try {
      const tutorRequest = buildTutorRequest({
        exam,
        question,
        profile,
        message: content,
        dialogue: messagesForSession(session.id),
      });
      if (aiProvider.capabilities.chatStreaming && aiProvider.chatStream) {
        for await (const chunk of aiProvider.chatStream(tutorRequest)) {
          assistantContent += chunk;
          writeEvent({ type: "chunk", delta: chunk });
        }
      } else {
        assistantContent = await aiProvider.chat(tutorRequest);
        writeEvent({ type: "chunk", delta: assistantContent });
      }
      const result = database.transaction(() => {
        const user = insertMessage(session.id, "user", content);
        const assistant = insertMessage(session.id, "assistant", assistantContent);
        const activity = touchSession(session.id, content);
        return { user, assistant, ...activity };
      })();
      writeEvent({ type: "done", ...result });
    } catch {
      writeEvent({ type: "error", error: "AI tutor stream failed" });
    } finally {
      response.end();
    }
  });

  app.post("/api/chats/:id/messages", async (request, response) => {
    const session = getSession(request.params.id);
    if (session.kind !== "tutor") return response.status(409).json({ error: "This chat does not accept tutor messages" });
    if (session.status === "completed") return response.status(409).json({ error: "Chat is completed" });
    const { content } = z.object({ content: z.string().trim().min(1).max(8_000) }).parse(request.body);
    const exam = examMap.get(session.exam_id);
    const question = exam?.questions.find((item) => item.id === session.question_id);
    const profile = exam ? resolveProfile(exam, session.profile_id) : undefined;
    if (!exam || !question || !profile) return response.status(409).json({ error: "Chat content is unavailable" });
    const aiProvider = currentAIProvider();
    if (!aiProvider) return response.status(503).json({ error: "AI tutor is not configured" });
    let assistantContent: string;
    try {
      assistantContent = await aiProvider.chat(buildTutorRequest({
        exam,
        question,
        profile,
        message: content,
        dialogue: messagesForSession(session.id),
      }));
    } catch {
      return response.status(502).json({ error: "AI tutor request failed" });
    }
    const result = database.transaction(() => {
      const user = insertMessage(session.id, "user", content);
      const assistant = insertMessage(session.id, "assistant", assistantContent);
      const activity = touchSession(session.id, content);
      return { user, assistant, ...activity };
    })();
    response.status(201).json(result);
  });

  app.post("/api/sessions/:id/messages", (request, response) => {
    getSession(request.params.id);
    const { content } = z.object({ content: z.string().min(1) }).parse(request.body);
    response.status(201).json(insertMessage(request.params.id, "user", content));
  });

  async function processReview(sessionId: string, answer: string) {
    const session = getSession(sessionId);
    if (session.kind === "tutor") {
      throw Object.assign(new Error("Tutor chats cannot be scored"), { status: 409 });
    }
    if (session.status === "completed") {
      throw Object.assign(new Error("Session is already completed"), { status: 409 });
    }
    const exam = examMap.get(session.exam_id);
    const question = exam?.questions.find((candidate) => candidate.id === session.question_id);
    const profile = exam ? resolveProfile(exam, session.profile_id) : undefined;
    if (!exam || !question || !profile) {
      throw Object.assign(new Error("Session content is unavailable"), { status: 409 });
    }
    const dialogue = messagesForSession(session.id);

    const aiProvider = currentAIProvider();
    if (!aiProvider) {
      throw Object.assign(new Error("AI review is not configured"), { status: 503 });
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
      const xp = database.transaction(() => {
        insertMessage(session.id, "user", answer);
        insertMessage(session.id, "assistant", review.examinerMessage);
        const awarded = persistReview(session, review, answer, true, false);
        touchSession(session.id, answer);
        return awarded;
      })();
      return { ...review, xp };
    }

    const requestInput = buildReviewRequest({
      exam,
      question,
      profile,
      answer,
      dialogue,
      forceFinal: session.kind === "exam" || session.follow_up_count >= exam.policy.maxFollowUps,
      sessionKind: session.kind,
    });
    let parsed;
    try {
      parsed = validateProviderResponse(
        await aiProvider.review(requestInput),
        question,
        requestInput.forceFinal,
      );
    } catch {
      throw Object.assign(new Error("AI review request failed"), { status: 502 });
    }
    if (!parsed.success) {
      try {
        parsed = validateProviderResponse(
          await aiProvider.review({ ...requestInput, repair: true }),
          question,
          requestInput.forceFinal,
        );
      } catch {
        throw Object.assign(new Error("AI review repair failed"), { status: 502 });
      }
    }
    if (!parsed.success) {
      throw Object.assign(new Error("AI returned an invalid response twice."), {
        status: 502,
        code: "invalid_ai_response",
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
    const xp = database.transaction(() => {
      insertMessage(session.id, "user", answer);
      insertMessage(session.id, "assistant", review.examinerMessage);
      if (!completed) {
        database
          .prepare("UPDATE sessions SET follow_up_count = follow_up_count + 1 WHERE id = ?")
          .run(session.id);
      }
      const awarded = persistReview(session, review, answer, completed);
      touchSession(session.id, answer);
      return awarded;
    })();
    return { ...review, xp };
  }

  app.post("/api/sessions/:id/review", async (request, response) => {
    const { answer } = z.object({ answer: z.string().trim().min(1).max(8_000) }).parse(request.body);
    response.json(await processReview(request.params.id, answer));
  });

  app.post("/api/chats/:id/review", async (request, response) => {
    const session = getSession(request.params.id);
    if (session.kind !== "review") return response.status(409).json({ error: "This chat is not a review" });
    const { answer } = z.object({ answer: z.string().trim().min(1).max(8_000) }).parse(request.body);
    response.json(await processReview(session.id, answer));
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

  function examHistorySummary(runId: string): ExamHistorySummary | undefined {
    const row = database.prepare(`
      SELECT exam_runs.id, exam_runs.exam_id, exam_runs.question_count, exam_runs.completed_at,
        AVG(exam_run_items.base_score) AS average_score,
        COALESCE(SUM(exam_run_items.xp), 0) AS total_xp
      FROM exam_runs
      JOIN exam_run_items ON exam_run_items.run_id = exam_runs.id
      WHERE exam_runs.id = ? AND exam_runs.status = 'completed'
      GROUP BY exam_runs.id
    `).get(runId) as {
      id: string;
      exam_id: string;
      question_count: number;
      completed_at: string;
      average_score: number | null;
      total_xp: number;
    } | undefined;
    if (!row) return undefined;
    const exam = examMap.get(row.exam_id);
    if (!exam) return undefined;
    return {
      runId: row.id,
      examId: row.exam_id,
      examTitle: exam.title,
      questionCount: row.question_count,
      ...(row.average_score === null ? {} : { averageScore: row.average_score }),
      totalXp: row.total_xp,
      completedAt: row.completed_at,
    };
  }

  app.get("/api/history", (_request, response) => {
    const completedRuns = database.prepare(`
      SELECT id FROM exam_runs
      WHERE status = 'completed'
      ORDER BY completed_at DESC, rowid DESC
    `).all() as Array<{ id: string }>;
    const examRuns = completedRuns
      .map((run) => examHistorySummary(run.id))
      .filter((run): run is ExamHistorySummary => Boolean(run));

    const rows = database
      .prepare(
        `SELECT attempts.*, reviews.payload_json
         FROM attempts
         JOIN reviews ON reviews.attempt_id = attempts.id
         JOIN sessions ON sessions.id = attempts.session_id
         WHERE sessions.exam_run_id IS NULL
         ORDER BY attempts.created_at DESC, attempts.rowid DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const studyAttempts: StudyAttemptHistoryEntry[] = rows.map((item) => {
      const locatedQuestion = findQuestion(String(item.question_id));
      return {
        id: String(item.id),
        sessionId: String(item.session_id),
        questionId: String(item.question_id),
        examId: locatedQuestion.exam.id,
        questionTitle: locatedQuestion.question.displayText,
        answer: String(item.answer),
        ...(item.base_score === null ? {} : { baseScore: Number(item.base_score) }),
        xp: Number(item.xp),
        createdAt: String(item.created_at),
        review: JSON.parse(String(item.payload_json)) as AIReview,
      };
    });
    const history: HistoryData = { examRuns, studyAttempts };
    response.json(history);
  });

  app.get("/api/history/exams/:id", (request, response) => {
    const summary = examHistorySummary(request.params.id);
    if (!summary) return response.status(404).json({ error: "Completed exam run not found" });
    const exam = examMap.get(summary.examId)!;
    const rows = database.prepare(`
      SELECT exam_run_items.position, exam_run_items.question_id, exam_run_items.base_score,
        exam_run_items.xp, attempts.answer, reviews.payload_json
      FROM exam_run_items
      JOIN sessions ON sessions.id = exam_run_items.session_id
      JOIN attempts ON attempts.session_id = sessions.id
      JOIN reviews ON reviews.attempt_id = attempts.id
      WHERE exam_run_items.run_id = ?
      ORDER BY exam_run_items.position
    `).all(request.params.id) as Array<{
      position: number;
      question_id: string;
      base_score: number | null;
      xp: number;
      answer: string;
      payload_json: string;
    }>;
    const detail: ExamHistoryDetail = {
      summary,
      items: rows.map((row) => {
        const question = exam.questions.find((item) => item.id === row.question_id)!;
        return {
          position: row.position,
          questionId: row.question_id,
          questionTitle: question.displayText,
          officialText: question.officialText,
          answer: row.answer,
          ...(row.base_score === null ? {} : { baseScore: row.base_score }),
          xp: row.xp,
          review: JSON.parse(row.payload_json) as AIReview,
        };
      }),
    };
    response.json(detail);
  });

  app.get("/api/settings/ai", (_request, response) => {
    if (!options.runtimeAI) {
      return response.status(501).json({ error: "Runtime AI settings are not available" });
    }
    response.json(options.runtimeAI.getState());
  });

  app.put("/api/settings/ai", (request, response) => {
    if (!options.runtimeAI) {
      return response.status(501).json({ error: "Runtime AI settings are not available" });
    }
    try {
      response.json(options.runtimeAI.update(request.body));
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      response.status(400).json({
        error: error instanceof Error ? error.message : "Invalid AI settings",
      });
    }
  });

  app.post("/api/settings/ai/test-text", async (_request, response) => {
    const aiProvider = currentAIProvider();
    const selected = options.runtimeAI?.getState().text;
    if (!aiProvider || !selected) {
      return response.status(503).json({ ok: false, message: "AI is not configured" });
    }
    const result = await aiProvider.testConnection();
    response.status(result.ok ? 200 : 502).json({
      ...result,
      provider: selected.provider,
      model: selected.model,
    });
  });

  app.post("/api/settings/ai/test-speech", (request, response, next) => {
    const speechProvider = currentSpeechProvider();
    const selected = options.runtimeAI?.getState().speech;
    if (!speechProvider || !selected || selected.provider === "disabled") {
      return response.status(503).json({ ok: false, message: "Speech is not configured" });
    }
    upload.single("audio")(request, response, (error) => {
      if (error) return next(error);
      void (async () => {
        if (!request.file) {
          return response.status(400).json({ error: "A supported audio file is required" });
        }
        try {
          const result = await speechProvider.transcribe({
            buffer: request.file.buffer,
            fileName: request.file.originalname || "test.webm",
            mimeType: request.file.mimetype,
            prompt: "Короткая проверка распознавания русской речи.",
          });
          response.json({ ok: true, provider: selected.provider, ...result });
        } catch {
          response.status(502).json({
            ok: false,
            provider: selected.provider,
            model: selected.model,
            message: "Voice transcription failed",
          });
        }
      })().catch(next);
    });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE" ? "Audio file is too large" : "Invalid audio upload",
      });
    }
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

import type {
  AIReview,
  AIConnectionTestResult,
  Attempt,
  ExamPackage,
  ExamHistoryDetail,
  ExamQuestion,
  ExamQuestionCount,
  ExamRun,
  ExamRunStep,
  HistoryData,
  SessionMessage,
  SessionKind,
  SourceDocument,
  StudyChatDetail,
  StudyChatSummary,
  StudyMode,
  StudySession,
  TutorTurnResponse,
  RuntimeAISettings,
  RuntimeAISettingsUpdate,
} from "../../shared/contracts.js";
import { calculateExamRunSummary, selectQuestionIds } from "../../shared/exam-run.js";

export interface ExamSummary {
  id: string;
  version: string;
  title: string;
  description: string;
  subject: string;
  questionCount: number;
  readyCount: number;
}

export type ExamDetail = Omit<ExamPackage, "documents" | "questions"> & {
  documents: Array<Omit<SourceDocument, "fragments">>;
  questions: Array<Omit<ExamQuestion, "referenceAnswer">>;
};

export type QuestionDetail = ExamQuestion & {
  note: string;
  bookmarked: boolean;
  progress: {
    attempts: number;
    bestScore?: number;
    readiness: "not_started" | "review" | "almost_ready" | "ready";
  };
};

export interface ReviewResponse extends AIReview {
  xp: number;
}

export interface ExamApi {
  listExams(): Promise<ExamSummary[]>;
  getExam(examId: string): Promise<ExamDetail>;
  getQuestion(examId: string, questionId: string): Promise<QuestionDetail>;
  getDocument(examId: string, documentId: string, page?: number): Promise<SourceDocument>;
  createSession(input: {
    examId: string;
    questionId?: string;
    mode: StudyMode;
    profileId: string;
  }): Promise<StudySession>;
  createExamRun(input: {
    examId: string;
    profileId: string;
    questionCount: ExamQuestionCount;
  }): Promise<ExamRunStep>;
  getExamRun(runId: string): Promise<ExamRunStep>;
  advanceExamRun(runId: string): Promise<ExamRunStep>;
  cancelExamRun(runId: string): Promise<void>;
  listChats(examId: string, questionId: string): Promise<StudyChatSummary[]>;
  createChat(input: {
    examId: string;
    questionId: string;
    kind: Exclude<SessionKind, "exam">;
    profileId: string;
  }): Promise<StudyChatDetail>;
  getChat(chatId: string): Promise<StudyChatDetail>;
  sendTutorMessage(chatId: string, content: string): Promise<TutorTurnResponse>;
  reviewChat(chatId: string, answer: string): Promise<ReviewResponse>;
  transcribe(audio: Blob, questionId: string): Promise<{ text: string; model: string }>;
  sendMessage(sessionId: string, content: string): Promise<SessionMessage>;
  review(sessionId: string, answer: string): Promise<ReviewResponse>;
  updateNote(questionId: string, note: string): Promise<{ questionId: string; note: string }>;
  updateBookmark(
    questionId: string,
    bookmarked: boolean,
  ): Promise<{ questionId: string; bookmarked: boolean }>;
  getHistory(): Promise<HistoryData>;
  getExamHistory(runId: string): Promise<ExamHistoryDetail>;
  getAISettings(): Promise<RuntimeAISettings>;
  updateAISettings(input: RuntimeAISettingsUpdate): Promise<RuntimeAISettings>;
  testAIText(): Promise<AIConnectionTestResult>;
  testAISpeech(audio: Blob): Promise<AIConnectionTestResult & { text?: string }>;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const rawBody = await response.text();
  let body: T & { error?: string };
  try {
    body = JSON.parse(rawBody) as T & { error?: string };
  } catch {
    throw new Error("Сервер API недоступен или запущена устаревшая версия");
  }
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
  return body;
}

function isHistoryData(value: unknown): value is HistoryData {
  if (!value || typeof value !== "object") return false;
  const history = value as Partial<HistoryData>;
  return Array.isArray(history.examRuns) && Array.isArray(history.studyAttempts);
}

export class HttpExamApi implements ExamApi {
  listExams() {
    return jsonRequest<ExamSummary[]>("/api/exams");
  }

  getExam(examId: string) {
    return jsonRequest<ExamDetail>(`/api/exams/${examId}`);
  }

  getQuestion(examId: string, questionId: string) {
    return jsonRequest<QuestionDetail>(`/api/exams/${examId}/questions/${questionId}`);
  }

  getDocument(examId: string, documentId: string, page?: number) {
    const query = page ? `?page=${page}` : "";
    return jsonRequest<SourceDocument>(
      `/api/exams/${examId}/documents/${documentId}${query}`,
    );
  }

  createSession(input: Parameters<ExamApi["createSession"]>[0]) {
    return jsonRequest<StudySession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createExamRun(input: Parameters<ExamApi["createExamRun"]>[0]) {
    return jsonRequest<ExamRunStep>("/api/exam-runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getExamRun(runId: string) {
    return jsonRequest<ExamRunStep>(`/api/exam-runs/${runId}`);
  }

  advanceExamRun(runId: string) {
    return jsonRequest<ExamRunStep>(`/api/exam-runs/${runId}/next`, {
      method: "POST",
      body: "{}",
    });
  }

  cancelExamRun(runId: string) {
    return jsonRequest<void>(`/api/exam-runs/${runId}`, { method: "DELETE" });
  }

  listChats(examId: string, questionId: string) {
    return jsonRequest<StudyChatSummary[]>(`/api/exams/${examId}/questions/${questionId}/chats`);
  }

  createChat(input: Parameters<ExamApi["createChat"]>[0]) {
    return jsonRequest<StudyChatDetail>(
      `/api/exams/${input.examId}/questions/${input.questionId}/chats`,
      { method: "POST", body: JSON.stringify({ kind: input.kind, profileId: input.profileId }) },
    );
  }

  getChat(chatId: string) {
    return jsonRequest<StudyChatDetail>(`/api/chats/${chatId}`);
  }

  sendTutorMessage(chatId: string, content: string) {
    return jsonRequest<TutorTurnResponse>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  reviewChat(chatId: string, answer: string) {
    return jsonRequest<ReviewResponse>(`/api/chats/${chatId}/review`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
  }

  async transcribe(audio: Blob, questionId: string) {
    const body = new FormData();
    const extension = audio.type.includes("ogg") ? "ogg" : "webm";
    body.append("audio", audio, `answer.${extension}`);
    body.append("questionId", questionId);
    const response = await fetch("/api/transcriptions", { method: "POST", body });
    const payload = await response.json() as { text?: string; model?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Не удалось распознать речь");
    return { text: payload.text ?? "", model: payload.model ?? "unknown" };
  }

  sendMessage(sessionId: string, content: string) {
    return jsonRequest<SessionMessage>(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  review(sessionId: string, answer: string) {
    return jsonRequest<ReviewResponse>(`/api/sessions/${sessionId}/review`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
  }

  updateNote(questionId: string, note: string) {
    return jsonRequest<{ questionId: string; note: string }>(
      `/api/questions/${questionId}/note`,
      { method: "PUT", body: JSON.stringify({ note }) },
    );
  }

  updateBookmark(questionId: string, bookmarked: boolean) {
    return jsonRequest<{ questionId: string; bookmarked: boolean }>(
      `/api/questions/${questionId}/bookmark`,
      { method: "PUT", body: JSON.stringify({ bookmarked }) },
    );
  }

  async getHistory() {
    const history = await jsonRequest<unknown>("/api/history");
    if (!isHistoryData(history)) {
      throw new Error("Сервер API недоступен или запущена устаревшая версия");
    }
    return history;
  }

  getExamHistory(runId: string) {
    return jsonRequest<ExamHistoryDetail>(`/api/history/exams/${runId}`);
  }

  getAISettings() {
    return jsonRequest<RuntimeAISettings>("/api/settings/ai");
  }

  updateAISettings(input: RuntimeAISettingsUpdate) {
    return jsonRequest<RuntimeAISettings>("/api/settings/ai", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  testAIText() {
    return jsonRequest<AIConnectionTestResult>("/api/settings/ai/test-text", {
      method: "POST",
      body: "{}",
    });
  }

  async testAISpeech(audio: Blob) {
    const body = new FormData();
    const extension = audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "webm";
    body.append("audio", audio, `test.${extension}`);
    const response = await fetch("/api/settings/ai/test-speech", { method: "POST", body });
    const payload = await response.json() as AIConnectionTestResult & { text?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? payload.message ?? "Не удалось проверить распознавание");
    return payload;
  }
}

const mockExam: ExamPackage = {
  id: "mock-database",
  version: "mock-1",
  title: "Демонстрационный экзамен",
  description: "Mock-пакет для отладки интерфейса без сервера.",
  subject: "Базы данных",
  profiles: [
    {
      id: "mentor", name: "Наставник", description: "Помогает уточнениями", tone: "supportive",
      quickPrompts: [{ id: "pizza", label: "Пример с пиццей", prompt: "Объясни тему на примере доставки пиццы" }],
    },
    {
      id: "strict", name: "Комиссия", description: "Требует точности", tone: "strict",
      quickPrompts: [{ id: "counterexample", label: "Контрпример", prompt: "Приведи сложный контрпример" }],
    },
  ],
  documents: [
    {
      id: "manual",
      title: "Учебный фрагмент",
      type: "text",
      path: "mock.txt",
      pageCount: 1,
      fragments: [
        {
          id: "manual-p1-f1",
          page: 1,
          text: "Транзакция является логической единицей работы и обладает свойствами ACID.",
        },
      ],
    },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "Транзакции. Свойства транзакции.",
      displayText: "Транзакции и свойства ACID",
      groupId: "core",
      groupTitle: "Основы",
      referenceAnswer: "Транзакция — логическая единица работы с гарантиями ACID.",
      emphasis: ["атомарность", "согласованность", "изоляция", "долговечность"],
      sources: [{ documentId: "manual", page: 1, fragmentId: "manual-p1-f1" }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: { timerMinutes: null, maxFollowUps: 2, referenceReveal: "after_attempt_or_explicit" },
  styleGuide: "Пиши точно.",
};

const mockBaseQuestion = mockExam.questions[0];
mockExam.questions = Array.from({ length: 5 }, (_, index) => ({
  ...mockBaseQuestion,
  id: `q-${index + 1}`,
  officialNumber: index + 1,
  officialText: `${mockBaseQuestion.officialText} Вариант ${index + 1}.`,
  displayText: `${mockBaseQuestion.displayText}: вопрос ${index + 1}`,
}));

export class MockExamApi implements ExamApi {
  private static readonly studyChatsStorageKey = "virtex:mock-study-chats";
  private followUps = new Map<string, number>();
  private notes = new Map<string, string>();
  private bookmarks = new Set<string>();
  private attempts: Attempt[] = [];
  private reviews: AIReview[] = [];
  private sessions = new Map<string, StudySession>();
  private runs = new Map<string, ExamRun>();
  private runSessions = new Map<string, { runId: string; position: number }>();
  private chatMessages = new Map<string, SessionMessage[]>();
  private chatReviews = new Map<string, AIReview[]>();
  private runtimeAISettings: RuntimeAISettings = {
    keys: {
      openrouter: { configured: true, source: "environment" },
      groq: { configured: true, source: "environment" },
    },
    text: { provider: "openrouter", model: "openai/gpt-5-mini", available: true },
    speech: { provider: "groq", model: "whisper-large-v3-turbo", available: true },
  };

  constructor(private readonly latency = 550) {
    this.restoreStudyChats();
  }

  private restoreStudyChats() {
    if (typeof localStorage === "undefined") return;
    try {
      const stored = JSON.parse(localStorage.getItem(MockExamApi.studyChatsStorageKey) ?? "null") as {
        sessions?: StudySession[];
        messages?: Array<[string, SessionMessage[]]>;
        reviews?: Array<[string, AIReview[]]>;
      } | null;
      for (const session of stored?.sessions ?? []) {
        this.sessions.set(session.id, session);
        this.followUps.set(session.id, session.followUpCount);
      }
      for (const [chatId, messages] of stored?.messages ?? []) this.chatMessages.set(chatId, messages);
      for (const [chatId, reviews] of stored?.reviews ?? []) this.chatReviews.set(chatId, reviews);
    } catch {
      localStorage.removeItem(MockExamApi.studyChatsStorageKey);
    }
  }

  private persistStudyChats() {
    if (typeof localStorage === "undefined") return;
    const sessions = [...this.sessions.values()].filter((session) => session.kind !== "exam");
    const chatIds = new Set(sessions.map((session) => session.id));
    localStorage.setItem(MockExamApi.studyChatsStorageKey, JSON.stringify({
      sessions,
      messages: [...this.chatMessages].filter(([chatId]) => chatIds.has(chatId)),
      reviews: [...this.chatReviews].filter(([chatId]) => chatIds.has(chatId)),
    }));
  }

  private async delay() {
    await new Promise((resolve) => setTimeout(resolve, this.latency));
  }

  async listExams() {
    await this.delay();
    return [{
      id: mockExam.id,
      version: mockExam.version,
      title: mockExam.title,
      description: mockExam.description,
      subject: mockExam.subject,
      questionCount: mockExam.questions.length,
      readyCount: 0,
    }];
  }

  async getExam() {
    await this.delay();
    return {
      ...mockExam,
      documents: mockExam.documents.map(({ fragments: _fragments, ...document }) => document),
      questions: mockExam.questions.map(({ referenceAnswer: _answer, ...question }) => question),
    };
  }

  async getQuestion(_examId: string, questionId: string) {
    await this.delay();
    const question = mockExam.questions.find((item) => item.id === questionId)!;
    return {
      ...question,
      note: this.notes.get(questionId) ?? "",
      bookmarked: this.bookmarks.has(questionId),
      progress: { attempts: 0, readiness: "not_started" as const },
    };
  }

  async getDocument() {
    await this.delay();
    return mockExam.documents[0];
  }

  async createSession(input: Parameters<ExamApi["createSession"]>[0]) {
    await this.delay();
    const id = crypto.randomUUID();
    this.followUps.set(id, 0);
    const session: StudySession = {
      id,
      examId: mockExam.id,
      questionId: input.questionId ?? mockExam.questions[0].id,
      mode: input.mode,
      kind: input.mode === "exam" ? "exam" : "review",
      title: input.mode === "exam" ? "Экзамен" : "Проверка ответа",
      profileId: input.profileId,
      status: "active" as const,
      followUpCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async createExamRun(input: Parameters<ExamApi["createExamRun"]>[0]): Promise<ExamRunStep> {
    await this.delay();
    const questionIds = selectQuestionIds(
      mockExam.questions.map((question) => question.id),
      input.questionCount,
      () => 0,
    );
    const run: ExamRun = {
      id: crypto.randomUUID(),
      examId: input.examId,
      profileId: input.profileId,
      questionCount: input.questionCount,
      currentPosition: 1,
      status: "active",
      items: questionIds.map((questionId, index) => ({
        id: crypto.randomUUID(),
        questionId,
        position: index + 1,
        status: index === 0 ? "active" : "pending",
        xp: 0,
      })),
      createdAt: new Date().toISOString(),
    };
    const session = await this.createSession({
      examId: input.examId,
      questionId: questionIds[0],
      mode: "exam",
      profileId: input.profileId,
    });
    run.items[0].sessionId = session.id;
    this.runs.set(run.id, run);
    this.runSessions.set(session.id, { runId: run.id, position: 1 });
    return { run, session };
  }

  async getExamRun(runId: string): Promise<ExamRunStep> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run) throw new Error("Exam run not found");
    if (run.status === "completed") {
      return { run, summary: calculateExamRunSummary(run.items, mockExam.thresholds) };
    }
    const active = run.items.find((item) => item.status === "active");
    const session = active?.sessionId ? this.sessions.get(active.sessionId) : undefined;
    return { run, ...(session ? { session } : {}) };
  }

  async advanceExamRun(runId: string): Promise<ExamRunStep> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run) throw new Error("Exam run not found");
    if (run.status === "completed") {
      return { run, summary: calculateExamRunSummary(run.items, mockExam.thresholds) };
    }
    if (run.items.some((item) => item.status === "active")) {
      throw new Error("Current question is not completed");
    }
    const next = run.items.find((item) => item.status === "pending");
    if (!next) {
      run.status = "completed";
      run.completedAt = new Date().toISOString();
      return { run, summary: calculateExamRunSummary(run.items, mockExam.thresholds) };
    }
    next.status = "active";
    run.currentPosition = next.position;
    const session = await this.createSession({
      examId: run.examId,
      questionId: next.questionId,
      mode: "exam",
      profileId: run.profileId,
    });
    next.sessionId = session.id;
    this.runSessions.set(session.id, { runId, position: next.position });
    return { run, session };
  }

  async cancelExamRun(runId: string): Promise<void> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run) throw new Error("Exam run not found");
    if (run.status !== "active") throw new Error("Completed exam runs cannot be cancelled");

    const sessionIds = new Set(run.items.flatMap((item) => item.sessionId ? [item.sessionId] : []));
    const retained = this.attempts
      .map((attempt, index) => ({ attempt, review: this.reviews[index] }))
      .filter(({ attempt }) => !sessionIds.has(attempt.sessionId));
    this.attempts = retained.map(({ attempt }) => attempt);
    this.reviews = retained.flatMap(({ review }) => review ? [review] : []);
    for (const sessionId of sessionIds) {
      this.sessions.delete(sessionId);
      this.followUps.delete(sessionId);
      this.runSessions.delete(sessionId);
    }
    this.runs.delete(runId);
  }

  async listChats(examId: string, questionId: string): Promise<StudyChatSummary[]> {
    await this.delay();
    return [...this.sessions.values()]
      .filter((session) => session.examId === examId && session.questionId === questionId && session.kind !== "exam")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => {
        const messages = this.chatMessages.get(session.id) ?? [];
        const reviews = this.chatReviews.get(session.id) ?? [];
        return {
          ...session,
          messageCount: messages.length,
          ...(messages.at(-1) ? { latestMessage: messages.at(-1)!.content } : {}),
          ...(reviews.at(-1) ? { latestReview: reviews.at(-1)! } : {}),
        };
      });
  }

  async createChat(input: Parameters<ExamApi["createChat"]>[0]): Promise<StudyChatDetail> {
    await this.delay();
    const now = new Date().toISOString();
    const session: StudySession = {
      id: crypto.randomUUID(),
      examId: input.examId,
      questionId: input.questionId,
      mode: "study",
      kind: input.kind,
      title: input.kind === "tutor" ? "Разбор темы" : "Проверка ответа",
      profileId: input.profileId,
      status: "active",
      followUpCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    this.chatMessages.set(session.id, []);
    this.chatReviews.set(session.id, []);
    this.persistStudyChats();
    return { ...session, messages: [], reviews: [] };
  }

  async getChat(chatId: string): Promise<StudyChatDetail> {
    await this.delay();
    const session = this.sessions.get(chatId);
    if (!session || session.kind === "exam") throw new Error("Chat not found");
    return {
      ...session,
      messages: this.chatMessages.get(chatId) ?? [],
      reviews: this.chatReviews.get(chatId) ?? [],
    };
  }

  async sendTutorMessage(chatId: string, content: string): Promise<TutorTurnResponse> {
    await this.delay();
    const session = this.sessions.get(chatId);
    if (!session || session.kind !== "tutor") throw new Error("Tutor chat not found");
    const now = new Date().toISOString();
    const user: SessionMessage = { id: crypto.randomUUID(), sessionId: chatId, role: "user", content, createdAt: now };
    const assistant: SessionMessage = {
      id: crypto.randomUUID(), sessionId: chatId, role: "assistant",
      content: `Разберём это на понятном примере. ${content.includes("пицц") ? "Заказ пиццы проходит как единая операция: либо подтверждаются все шаги, либо заказ отменяется целиком." : "Сначала выделите определение, затем механизм и практическое следствие."}`,
      createdAt: now,
    };
    const title = content.length > 64 ? `${content.slice(0, 61)}…` : content;
    this.chatMessages.set(chatId, [...(this.chatMessages.get(chatId) ?? []), user, assistant]);
    this.sessions.set(chatId, { ...session, title, updatedAt: now });
    this.persistStudyChats();
    return { user, assistant, title, updatedAt: now };
  }

  async reviewChat(chatId: string, answer: string): Promise<ReviewResponse> {
    const result = await this.review(chatId, answer);
    const session = this.sessions.get(chatId)!;
    const now = new Date().toISOString();
    const messages = this.chatMessages.get(chatId) ?? [];
    this.chatMessages.set(chatId, [
      ...messages,
      { id: crypto.randomUUID(), sessionId: chatId, role: "user", content: answer, createdAt: now },
      { id: crypto.randomUUID(), sessionId: chatId, role: "assistant", content: result.examinerMessage, createdAt: now },
    ]);
    this.chatReviews.set(chatId, [...(this.chatReviews.get(chatId) ?? []), result]);
    this.sessions.set(chatId, {
      ...session,
      title: session.title === "Проверка ответа" ? (answer.length > 64 ? `${answer.slice(0, 61)}…` : answer) : session.title,
      updatedAt: now,
      status: result.action === "final" ? "completed" : "active",
      ...(result.action === "final" ? { completedAt: now } : {}),
    });
    this.persistStudyChats();
    return result;
  }

  async transcribe(_audio: Blob, _questionId: string) {
    await this.delay();
    return { text: "Транзакция — логическая единица работы с гарантиями ACID.", model: "mock-whisper" };
  }

  async sendMessage(sessionId: string, content: string) {
    localStorage.setItem(`virtex:draft:${sessionId}`, content);
    return {
      id: crypto.randomUUID(), sessionId, role: "user" as const, content, createdAt: new Date().toISOString(),
    };
  }

  async review(sessionId: string, answer: string): Promise<ReviewResponse> {
    await this.delay();
    if (answer.includes("[api-error]")) throw new Error("Имитация ошибки API");
    if (answer.includes("[offline]")) throw new Error("AI-проверка недоступна");
    const count = this.followUps.get(sessionId) ?? 0;
    if (answer.length < 80 && count < 2) {
      const followUpCount = count + 1;
      this.followUps.set(sessionId, followUpCount);
      const session = this.sessions.get(sessionId);
      if (session) this.sessions.set(sessionId, { ...session, followUpCount });
      return {
        action: "clarify",
        examinerMessage: "Какие гарантии входят в ACID?",
        personaVerdict: "Нужно уточнение",
        strengths: [], gaps: ["ACID"], errors: [], citations: [], advice: "Дополните ответ.",
        model: "mock", packageVersion: mockExam.version, promptVersion: "mock", schemaVersion: "mock", xp: 0,
      };
    }
    const score = Math.min(96, 55 + Math.floor(answer.length / 4));
    const xp = score >= 80 ? 20 : 10;
    const review: AIReview = {
      action: "final", examinerMessage: "Ответ проверен.", baseScore: score,
      personaVerdict: score >= 80 ? "Готов" : "Нужно повторить",
      strengths: ["Есть определение"], gaps: score >= 80 ? [] : ["Не все свойства раскрыты"],
      errors: [], citations: mockExam.questions[0].sources, advice: "Сформулируйте ответ вслух ещё раз.",
      model: "mock", packageVersion: mockExam.version, promptVersion: "mock", schemaVersion: "mock",
    };
    this.reviews.unshift(review);
    this.attempts.unshift({
      id: crypto.randomUUID(), sessionId, questionId: this.sessions.get(sessionId)?.questionId ?? "q-1", answer, baseScore: score,
      xp, createdAt: new Date().toISOString(),
    });
    const binding = this.runSessions.get(sessionId);
    if (binding) {
      const run = this.runs.get(binding.runId)!;
      const item = run.items.find((candidate) => candidate.position === binding.position)!;
      item.status = "completed";
      item.baseScore = score;
      item.xp = xp;
      if (run.items.every((candidate) => candidate.status === "completed")) {
        run.status = "completed";
        run.completedAt = new Date().toISOString();
      }
    }
    return { ...review, xp };
  }

  async updateNote(questionId: string, note: string) {
    this.notes.set(questionId, note);
    return { questionId, note };
  }

  async updateBookmark(questionId: string, bookmarked: boolean) {
    bookmarked ? this.bookmarks.add(questionId) : this.bookmarks.delete(questionId);
    return { questionId, bookmarked };
  }

  private examHistorySummary(run: ExamRun) {
    const scored = run.items.flatMap((item) => item.baseScore === undefined ? [] : [item.baseScore]);
    return {
      runId: run.id,
      examId: run.examId,
      examTitle: mockExam.title,
      questionCount: run.questionCount,
      ...(scored.length === 0 ? {} : {
        averageScore: scored.reduce((sum, score) => sum + score, 0) / scored.length,
      }),
      totalXp: run.items.reduce((sum, item) => sum + item.xp, 0),
      completedAt: run.completedAt!,
    };
  }

  async getHistory(): Promise<HistoryData> {
    await this.delay();
    const examRuns = [...this.runs.values()]
      .filter((run) => run.status === "completed" && run.completedAt)
      .sort((left, right) => right.completedAt!.localeCompare(left.completedAt!))
      .map((run) => this.examHistorySummary(run));
    const studyAttempts = this.attempts.flatMap((attempt, index) => {
      if (this.runSessions.has(attempt.sessionId)) return [];
      const review = this.reviews[index];
      const question = mockExam.questions.find((item) => item.id === attempt.questionId);
      return review ? [{
        ...attempt,
        examId: mockExam.id,
        questionTitle: question?.displayText ?? attempt.questionId,
        review,
      }] : [];
    });
    return { examRuns, studyAttempts };
  }

  async getExamHistory(runId: string): Promise<ExamHistoryDetail> {
    await this.delay();
    const run = this.runs.get(runId);
    if (!run || run.status !== "completed" || !run.completedAt) {
      throw new Error("Completed exam run not found");
    }
    return {
      summary: this.examHistorySummary(run),
      items: run.items.map((item) => {
        const sessionId = item.sessionId!;
        const attemptIndex = this.attempts.findIndex((attempt) => attempt.sessionId === sessionId);
        const attempt = this.attempts[attemptIndex];
        const review = this.reviews[attemptIndex];
        const question = mockExam.questions.find((candidate) => candidate.id === item.questionId)!;
        return {
          position: item.position,
          questionId: item.questionId,
          questionTitle: question.displayText,
          officialText: question.officialText,
          answer: attempt.answer,
          ...(item.baseScore === undefined ? {} : { baseScore: item.baseScore }),
          xp: item.xp,
          review,
        };
      }),
    };
  }

  async getAISettings() {
    await this.delay();
    return structuredClone(this.runtimeAISettings);
  }

  async updateAISettings(input: RuntimeAISettingsUpdate) {
    await this.delay();
    this.runtimeAISettings = {
      keys: {
        openrouter: {
          configured: input.clearOpenrouterApiKey ? true : this.runtimeAISettings.keys.openrouter.configured || Boolean(input.openrouterApiKey),
          source: input.openrouterApiKey ? "application" : "environment",
        },
        groq: {
          configured: input.clearGroqApiKey ? true : this.runtimeAISettings.keys.groq.configured || Boolean(input.groqApiKey),
          source: input.groqApiKey ? "application" : "environment",
        },
      },
      text: { provider: input.textProvider, model: input.textModel, available: true },
      speech: {
        provider: input.speechProvider,
        model: input.speechModel,
        available: input.speechProvider !== "disabled",
      },
    };
    return structuredClone(this.runtimeAISettings);
  }

  async testAIText(): Promise<AIConnectionTestResult> {
    await this.delay();
    return { ok: true, provider: this.runtimeAISettings.text.provider, model: this.runtimeAISettings.text.model };
  }

  async testAISpeech(_audio: Blob): Promise<AIConnectionTestResult & { text?: string }> {
    await this.delay();
    const provider = this.runtimeAISettings.speech.provider === "disabled"
      ? "groq"
      : this.runtimeAISettings.speech.provider;
    return { ok: true, provider, model: this.runtimeAISettings.speech.model, text: "Проверка распознавания" };
  }
}

export const api: ExamApi =
  import.meta.env.VITE_USE_MOCKS === "true" ? new MockExamApi() : new HttpExamApi();

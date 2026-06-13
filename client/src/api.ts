import type {
  AIReview,
  Attempt,
  ExamPackage,
  ExamQuestion,
  ExamQuestionCount,
  ExamRunStep,
  SessionMessage,
  SourceDocument,
  StudyMode,
  StudySession,
} from "../../shared/contracts.js";

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
  sendMessage(sessionId: string, content: string): Promise<SessionMessage>;
  review(sessionId: string, answer: string): Promise<ReviewResponse>;
  updateNote(questionId: string, note: string): Promise<{ questionId: string; note: string }>;
  updateBookmark(
    questionId: string,
    bookmarked: boolean,
  ): Promise<{ questionId: string; bookmarked: boolean }>;
  getHistory(): Promise<{ attempts: Attempt[]; reviews: AIReview[] }>;
  testAI(): Promise<{ ok: boolean; model?: string; message?: string }>;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
  return body;
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

  getHistory() {
    return jsonRequest<{ attempts: Attempt[]; reviews: AIReview[] }>("/api/history");
  }

  testAI() {
    return jsonRequest<{ ok: boolean; model?: string; message?: string }>(
      "/api/settings/ai/test",
      { method: "POST", body: "{}" },
    );
  }
}

const mockExam: ExamPackage = {
  id: "mock-database",
  version: "mock-1",
  title: "Демонстрационный экзамен",
  description: "Mock-пакет для отладки интерфейса без сервера.",
  subject: "Базы данных",
  profiles: [
    { id: "mentor", name: "Наставник", description: "Помогает уточнениями", tone: "supportive" },
    { id: "strict", name: "Комиссия", description: "Требует точности", tone: "strict" },
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

export class MockExamApi implements ExamApi {
  private followUps = new Map<string, number>();
  private notes = new Map<string, string>();
  private bookmarks = new Set<string>();
  private attempts: Attempt[] = [];
  private reviews: AIReview[] = [];

  constructor(private readonly latency = 550) {}

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
    return {
      id,
      examId: mockExam.id,
      questionId: input.questionId ?? mockExam.questions[0].id,
      mode: input.mode,
      profileId: input.profileId,
      status: "active" as const,
      followUpCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  async createExamRun(_input: Parameters<ExamApi["createExamRun"]>[0]): Promise<ExamRunStep> {
    throw new Error("Mock exam runs are not initialized");
  }

  async getExamRun(_runId: string): Promise<ExamRunStep> {
    throw new Error("Mock exam runs are not initialized");
  }

  async advanceExamRun(_runId: string): Promise<ExamRunStep> {
    throw new Error("Mock exam runs are not initialized");
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
    if (answer.includes("[offline]")) {
      return {
        action: "unavailable",
        examinerMessage: "Черновик сохранён офлайн.",
        personaVerdict: "Без оценки",
        strengths: [], gaps: [], errors: [], citations: [], advice: "Повторите позже.",
        packageVersion: mockExam.version, promptVersion: "mock", schemaVersion: "mock", xp: 10,
      };
    }
    const count = this.followUps.get(sessionId) ?? 0;
    if (answer.length < 80 && count < 2) {
      this.followUps.set(sessionId, count + 1);
      return {
        action: "clarify",
        examinerMessage: "Какие гарантии входят в ACID?",
        personaVerdict: "Нужно уточнение",
        strengths: [], gaps: ["ACID"], errors: [], citations: [], advice: "Дополните ответ.",
        model: "mock", packageVersion: mockExam.version, promptVersion: "mock", schemaVersion: "mock", xp: 0,
      };
    }
    const score = Math.min(96, 55 + Math.floor(answer.length / 4));
    const review: AIReview = {
      action: "final", examinerMessage: "Ответ проверен.", baseScore: score,
      personaVerdict: score >= 80 ? "Готов" : "Нужно повторить",
      strengths: ["Есть определение"], gaps: score >= 80 ? [] : ["Не все свойства раскрыты"],
      errors: [], citations: mockExam.questions[0].sources, advice: "Сформулируйте ответ вслух ещё раз.",
      model: "mock", packageVersion: mockExam.version, promptVersion: "mock", schemaVersion: "mock",
    };
    this.reviews.unshift(review);
    this.attempts.unshift({
      id: crypto.randomUUID(), sessionId, questionId: "q-1", answer, baseScore: score,
      xp: score >= 80 ? 20 : 10, createdAt: new Date().toISOString(),
    });
    return { ...review, xp: score >= 80 ? 20 : 10 };
  }

  async updateNote(questionId: string, note: string) {
    this.notes.set(questionId, note);
    return { questionId, note };
  }

  async updateBookmark(questionId: string, bookmarked: boolean) {
    bookmarked ? this.bookmarks.add(questionId) : this.bookmarks.delete(questionId);
    return { questionId, bookmarked };
  }

  async getHistory() {
    await this.delay();
    return { attempts: this.attempts, reviews: this.reviews };
  }

  async testAI() {
    await this.delay();
    return { ok: true, model: "mock-model" };
  }
}

export const api: ExamApi =
  import.meta.env.VITE_USE_MOCKS === "true" ? new MockExamApi() : new HttpExamApi();

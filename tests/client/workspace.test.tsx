import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExamApi } from "../../client/src/api.js";
import { Workspace } from "../../client/src/screens/Workspace.js";

const exam = {
  id: "exam",
  version: "1.0.0",
  title: "Database exam",
  description: "Fixture",
  subject: "Databases",
  profiles: [
    { id: "neutral", name: "Neutral", description: "Neutral", tone: "neutral" as const },
  ],
  documents: [
    { id: "book", title: "Book", type: "text" as const, path: "book.txt", pageCount: 1 },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "What is a transaction?",
      displayText: "What is a transaction?",
      groupId: "core",
      groupTitle: "Core",
      emphasis: ["atomic"],
      sources: [{ documentId: "book", page: 1, fragmentId: "book-p1-f1" }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: {
    timerMinutes: null,
    maxFollowUps: 2,
    referenceReveal: "after_attempt_or_explicit" as const,
  },
  styleGuide: "Be precise",
};

const question = {
  ...exam.questions[0],
  referenceAnswer: "A transaction is a logical unit of work.",
  note: "",
  bookmarked: false,
  progress: { attempts: 0, readiness: "not_started" as const },
};

function createApi(): ExamApi {
  return {
    listExams: vi.fn(),
    getExam: vi.fn().mockResolvedValue(exam),
    getQuestion: vi.fn().mockResolvedValue(question),
    getDocument: vi.fn().mockResolvedValue({
      ...exam.documents[0],
      fragments: [{ id: "book-p1-f1", page: 1, text: "Source fragment" }],
    }),
    createSession: vi.fn().mockResolvedValue({
      id: "session",
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      profileId: "neutral",
      status: "active",
      followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    createExamRun: vi.fn(),
    getExamRun: vi.fn(),
    advanceExamRun: vi.fn(),
    transcribe: vi.fn(),
    sendMessage: vi.fn(),
    review: vi.fn(),
    updateNote: vi.fn().mockResolvedValue({ questionId: "q-1", note: "My note" }),
    updateBookmark: vi
      .fn()
      .mockResolvedValue({ questionId: "q-1", bookmarked: true }),
    getHistory: vi.fn(),
    testAI: vi.fn(),
  };
}

function renderWorkspace(api: ExamApi, route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/exams/:examId/workspace/:questionId"
          element={<Workspace api={api} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Workspace", () => {
  it("creates a three-question run only after the user starts the exam", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.createExamRun).mockResolvedValue({
      run: {
        id: "run-1",
        examId: "exam",
        profileId: "neutral",
        questionCount: 3,
        currentPosition: 1,
        status: "active",
        items: [
          { id: "i1", questionId: "q-1", position: 1, status: "active", sessionId: "session", xp: 0 },
          { id: "i2", questionId: "q-2", position: 2, status: "pending", xp: 0 },
          { id: "i3", questionId: "q-3", position: 3, status: "pending", xp: 0 },
        ],
        createdAt: "2026-06-13T00:00:00.000Z",
      },
      session: {
        id: "session",
        examId: "exam",
        questionId: "q-1",
        mode: "exam",
        profileId: "neutral",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
      },
    });
    renderWorkspace(api, "/exams/exam/workspace/random?mode=exam&count=3");

    await user.click(await screen.findByRole("button", { name: /начать экзамен/i }));
    expect(api.createExamRun).toHaveBeenCalledWith({
      examId: "exam",
      profileId: "neutral",
      questionCount: 3,
    });
  });

  it("advances a run and renders its final summary", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const run = {
      id: "run-1",
      examId: "exam",
      profileId: "neutral",
      questionCount: 3 as const,
      currentPosition: 3,
      status: "active" as const,
      items: [
        { id: "i1", questionId: "q-1", position: 1, status: "completed" as const, baseScore: 84, xp: 20 },
        { id: "i2", questionId: "q-2", position: 2, status: "completed" as const, baseScore: 70, xp: 10 },
        { id: "i3", questionId: "q-1", position: 3, status: "active" as const, sessionId: "session", xp: 0 },
      ],
      createdAt: "2026-06-13T00:00:00.000Z",
    };
    vi.mocked(api.getExamRun).mockResolvedValue({
      run,
      session: {
        id: "session",
        examId: "exam",
        questionId: "q-1",
        mode: "exam",
        profileId: "neutral",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
      },
    });
    vi.mocked(api.review).mockResolvedValue({
      action: "final",
      examinerMessage: "Ответ принят.",
      baseScore: 40,
      personaVerdict: "Повторить",
      strengths: [],
      gaps: ["Детали"],
      errors: [],
      citations: [],
      advice: "Повторите тему.",
      packageVersion: "1.0.0",
      promptVersion: "v1",
      schemaVersion: "v1",
      xp: 10,
    });
    vi.mocked(api.advanceExamRun).mockResolvedValue({
      run: { ...run, status: "completed", items: [
        run.items[0],
        run.items[1],
        { ...run.items[2], status: "completed", baseScore: 40, xp: 10 },
      ] },
      summary: {
        averageScore: 65,
        ready: 1,
        almostReady: 1,
        review: 1,
        unscored: 0,
        totalXp: 40,
        results: [],
      },
    });
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=exam&run=run-1");

    const editor = await screen.findByRole("textbox", { name: /ответ на вопрос/i });
    await user.type(editor, "Финальный полный ответ");
    await user.click(screen.getByRole("button", { name: /отправить ответ/i }));
    await user.click(await screen.findByRole("button", { name: /завершить экзамен/i }));

    expect(await screen.findByText("65/100")).toBeInTheDocument();
    expect(screen.getByText(/40 XP/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /ответ на вопрос/i })).not.toBeInTheDocument();
  });

  it("shows the reference immediately in study mode", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=study");

    expect(await screen.findByText("What is a transaction?")).toBeInTheDocument();
    expect(screen.getByText(question.referenceAnswer)).toBeInTheDocument();
  });

  it("keeps answers unavailable during an active exam", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=exam");

    expect(await screen.findByText("What is a transaction?")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ответы/i })).toBeDisabled();
    expect(screen.queryByText(question.referenceAnswer)).not.toBeInTheDocument();
  });

  it("uses two right tabs and keeps the examiner profile in the main area", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=study");
    await screen.findByText("What is a transaction?");

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Ответы",
      "Заметки",
    ]);
    expect(screen.queryByRole("tab", { name: /источники/i })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByLabelText(/профиль экзаменатора/i),
    );
    expect(screen.getByRole("button", { name: /диктовать/i })).toBeInTheDocument();
  });

  it("persists notes and bookmarks through the repository", async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");
    await screen.findByText("What is a transaction?");

    await user.click(screen.getByRole("button", { name: /добавить в закладки/i }));
    await user.click(screen.getByRole("tab", { name: /заметки/i }));
    await user.type(screen.getByRole("textbox", { name: /заметка/i }), "My note");
    await user.click(screen.getByRole("button", { name: /сохранить заметку/i }));

    expect(api.updateBookmark).toHaveBeenCalledWith("q-1", true);
    expect(api.updateNote).toHaveBeenCalledWith("q-1", "My note");
  });

  it("clears the editor after a clarification and keeps the previous turn visible", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.review).mockResolvedValue({
      action: "clarify",
      examinerMessage: "Что означает атомарность?",
      personaVerdict: "Нужно уточнение",
      strengths: [],
      gaps: ["Атомарность"],
      errors: [],
      citations: [],
      advice: "Ответьте на уточнение.",
      model: "fake",
      packageVersion: "1.0.0",
      promptVersion: "v1",
      schemaVersion: "v1",
      xp: 0,
    });
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=practice");
    const editor = await screen.findByRole("textbox", { name: /ответ на вопрос/i });

    await user.type(editor, "Короткий ответ");
    await user.click(screen.getByRole("button", { name: /отправить ответ/i }));

    expect(await screen.findByText("Что означает атомарность?")).toBeInTheDocument();
    expect(screen.getAllByText("Что означает атомарность?")).toHaveLength(1);
    expect(editor).toHaveValue("");
    expect(screen.getAllByText("Короткий ответ")).toHaveLength(1);
  });

  it("updates readiness after a final review and offers a fresh attempt", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.review).mockResolvedValue({
      action: "final",
      examinerMessage: "Ответ принят.",
      baseScore: 84,
      personaVerdict: "Готов",
      strengths: ["Верное определение"],
      gaps: [],
      errors: [],
      citations: [],
      advice: "Повторите ответ вслух.",
      model: "fake",
      packageVersion: "1.0.0",
      promptVersion: "v1",
      schemaVersion: "v1",
      xp: 20,
    });
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=practice");
    const editor = await screen.findByRole("textbox", { name: /ответ на вопрос/i });

    await user.type(editor, "Полный ответ о транзакции");
    await user.click(screen.getByRole("button", { name: /отправить ответ/i }));

    expect(await screen.findByText("84/100")).toBeInTheDocument();
    expect(screen.getByText("1 попыток")).toBeInTheDocument();
    expect(editor).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /новая попытка/i }));
    expect(editor).toBeEnabled();
    expect(editor).toHaveValue("");
  });
});

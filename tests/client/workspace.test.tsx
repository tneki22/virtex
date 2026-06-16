import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExamApi, ExamDetail } from "../../client/src/api.js";
import { Workspace } from "../../client/src/screens/Workspace.js";

const exam = {
  id: "exam",
  version: "1.0.0",
  title: "Database exam",
  description: "Fixture",
  subject: "Databases",
  profiles: [
    {
      id: "neutral",
      name: "Neutral",
      description: "Neutral",
      tone: "neutral" as const,
      quickPrompts: [{ id: "pizza", label: "Pizza example", prompt: "Explain with pizza" }],
    },
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
      kind: "review",
      title: "Проверка ответа",
      profileId: "neutral",
      status: "active",
      followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    createExamRun: vi.fn(),
    getExamRun: vi.fn(),
    advanceExamRun: vi.fn(),
    cancelExamRun: vi.fn(),
    listChats: vi.fn().mockResolvedValue([]),
    createChat: vi.fn(),
    getChat: vi.fn(),
    sendTutorMessage: vi.fn(),
    reviewChat: vi.fn(),
    transcribe: vi.fn(),
    sendMessage: vi.fn(),
    review: vi.fn(),
    updateNote: vi.fn().mockResolvedValue({ questionId: "q-1", note: "My note" }),
    updateBookmark: vi
      .fn()
      .mockResolvedValue({ questionId: "q-1", bookmarked: true }),
    getHistory: vi.fn(),
    getExamHistory: vi.fn(),
    getAISettings: vi.fn(),
    updateAISettings: vi.fn(),
    testAIText: vi.fn(),
    testAISpeech: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function renderWorkspace(api: ExamApi, route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/exams/:examId/workspace/:questionId"
          element={<Workspace api={api} />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Workspace", () => {
  it("confirms cancellation, clears run drafts, and stays put when cancellation fails", async () => {
    const user = userEvent.setup();
    const api = createApi() as ExamApi & { cancelExamRun: ReturnType<typeof vi.fn> };
    api.cancelExamRun = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.getExamRun).mockResolvedValue({
      run: {
        id: "run-1",
        examId: "exam",
        profileId: "neutral",
        questionCount: 1,
        currentPosition: 1,
        status: "active",
        items: [{ id: "i1", questionId: "q-1", position: 1, status: "active", sessionId: "session", xp: 0 }],
        createdAt: "2026-06-14T10:00:00.000Z",
      },
      session: {
        id: "session",
        examId: "exam",
        questionId: "q-1",
        mode: "exam",
        kind: "exam",
        title: "Экзамен",
        profileId: "neutral",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-14T10:00:00.000Z",
        updatedAt: "2026-06-14T10:00:00.000Z",
      },
    });
    localStorage.setItem("virtex:draft:exam:q-1:run-1", "first");
    localStorage.setItem("virtex:draft:exam:q-2:run-1", "second");
    localStorage.setItem("virtex:draft:exam:q-1:run-2", "other run");
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=exam&run=run-1");

    await user.click(await screen.findByRole("button", { name: /^выйти$/i }));
    expect(screen.getByRole("dialog", { name: /прервать экзамен/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /остаться/i }));
    expect(api.cancelExamRun).not.toHaveBeenCalled();

    api.cancelExamRun.mockRejectedValueOnce(new Error("Не удалось прервать экзамен"));
    await user.click(screen.getByRole("button", { name: /^выйти$/i }));
    await user.click(screen.getByRole("button", { name: /прервать экзамен/i }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Не удалось прервать экзамен");
    expect(screen.queryByLabelText("location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /прервать экзамен/i }));
    expect(await screen.findByLabelText("location")).toHaveTextContent("/exams/exam");
    expect(localStorage.getItem("virtex:draft:exam:q-1:run-1")).toBeNull();
    expect(localStorage.getItem("virtex:draft:exam:q-2:run-1")).toBeNull();
    expect(localStorage.getItem("virtex:draft:exam:q-1:run-2")).toBe("other run");
  });
  it("navigates between questions without leaving fullscreen answers", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const secondQuestionSummary = {
      ...exam.questions[0],
      id: "q-2",
      officialNumber: 2,
      officialText: "What is isolation?",
      displayText: "What is isolation?",
    };
    const secondQuestion = {
      ...secondQuestionSummary,
      referenceAnswer: "Isolation keeps concurrent transactions independent.",
      note: "",
      bookmarked: false,
      progress: { attempts: 0, readiness: "not_started" as const },
    };
    vi.mocked(api.getExam).mockResolvedValue({
      ...exam,
      questions: [...exam.questions, secondQuestionSummary],
    });
    vi.mocked(api.getQuestion).mockImplementation(async (_examId, questionId) =>
      questionId === "q-2" ? secondQuestion : question,
    );

    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");
    const referencePanel = await screen.findByRole("complementary", { name: /ответы и заметки/i });
    await user.click(within(referencePanel).getByRole("button", { name: /развернуть документ на весь экран/i }));

    expect(within(referencePanel).getByText("1 из 2")).toBeInTheDocument();
    expect(within(referencePanel).getByRole("button", { name: /предыдущий вопрос/i })).toBeDisabled();
    await user.click(within(referencePanel).getByRole("button", { name: /следующий вопрос/i }));

    expect(await within(referencePanel).findByText(secondQuestion.referenceAnswer)).toBeInTheDocument();
    expect(referencePanel).toHaveClass("is-fullscreen");
    expect(within(referencePanel).getByText("2 из 2")).toBeInTheDocument();
    expect(within(referencePanel).getByRole("button", { name: /следующий вопрос/i })).toBeDisabled();
  });

  it("uses question text, topic counts, and collapsible workspace panels", async () => {
    const user = userEvent.setup();
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=study");

    const questionPanel = await screen.findByRole("complementary", {
      name: /навигация по вопросам/i,
    });
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(within(questionPanel).getByRole("link", { name: /в меню/i })).toBeInTheDocument();
    expect(within(questionPanel).getByText("What is a transaction?", { selector: "strong" })).toBeInTheDocument();
    expect(within(questionPanel).queryByText("Вопрос 1", { selector: "strong" })).not.toBeInTheDocument();
    expect(within(questionPanel).getByText("1 тема")).toBeInTheDocument();
    expect(within(questionPanel).queryByText(/ручной выбор/i)).not.toBeInTheDocument();

    await user.click(within(questionPanel).getByRole("button", { name: /свернуть список вопросов/i }));
    expect(within(questionPanel).queryByRole("textbox", { name: /поиск вопросов/i })).not.toBeInTheDocument();
    await user.click(within(questionPanel).getByRole("button", { name: /развернуть список вопросов/i }));
    expect(within(questionPanel).getByRole("textbox", { name: /поиск вопросов/i })).toBeInTheDocument();

    const referencePanel = screen.getByRole("complementary", { name: /ответы и заметки/i });
    await user.click(within(referencePanel).getByRole("button", { name: /развернуть документ на весь экран/i }));
    expect(referencePanel).toHaveClass("is-fullscreen");
    await user.click(within(referencePanel).getByRole("button", { name: /вернуть документ в панель/i }));
    expect(referencePanel).not.toHaveClass("is-fullscreen");
  });

  it("exposes the chat history disclosure state", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.listChats).mockResolvedValue([{
      id: "chat-1",
      examId: "exam",
      questionId: "q-1",
      mode: "study",
      kind: "tutor",
      title: "Transaction chat",
      profileId: "neutral",
      status: "active",
      followUpCount: 0,
      messageCount: 1,
      createdAt: "2026-06-14T10:00:00.000Z",
      updatedAt: "2026-06-14T10:00:00.000Z",
    }]);

    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");

    const historyButton = await screen.findByRole("button", { name: /история/i });
    expect(historyButton).toHaveAttribute("aria-expanded", "false");
    expect(historyButton).toHaveAttribute("aria-controls", "chat-history-popover");

    await user.click(historyButton);

    expect(historyButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /история чатов/i })).toHaveAttribute(
      "id",
      "chat-history-popover",
    );
  });

  it("restores the latest completed review without another AI request", async () => {
    const api = createApi();
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    const review = {
      action: "final" as const,
      examinerMessage: "Ответ принят.",
      baseScore: 84,
      personaVerdict: "Готов",
      strengths: ["Точно"],
      gaps: [],
      errors: [],
      citations: [],
      advice: "Повторить вслух",
      packageVersion: "1.0.0",
      promptVersion: "v1",
      schemaVersion: "v1",
    };
    vi.mocked(api.listChats).mockResolvedValue([{
      id: "chat-1", examId: "exam", questionId: "q-1", mode: "study", kind: "review",
      title: "Мой ответ", profileId: "neutral", status: "completed", followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T01:00:00.000Z",
      completedAt: "2026-01-01T01:00:00.000Z", messageCount: 2, latestReview: review,
    }]);
    vi.mocked(api.getChat).mockResolvedValue({
      id: "chat-1", examId: "exam", questionId: "q-1", mode: "study", kind: "review",
      title: "Мой ответ", profileId: "neutral", status: "completed", followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T01:00:00.000Z",
      completedAt: "2026-01-01T01:00:00.000Z",
      messages: [
        { id: "m1", sessionId: "chat-1", role: "user", content: "Мой полный ответ", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "m2", sessionId: "chat-1", role: "assistant", content: "**Ответ принят.**\n\n- пункт", createdAt: "2026-01-01T01:00:00.000Z" },
      ],
      reviews: [review],
    });

    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");

    expect(await screen.findByText("Мой полный ответ")).toBeInTheDocument();
    const dialogue = screen.getByRole("region", { name: /предыдущие реплики/i });
    await waitFor(() => expect(dialogue.scrollTop).toBe(900));
    expect(screen.getByText("Ответ принят.").tagName).toBe("STRONG");
    expect(screen.getByText("пункт").tagName).toBe("LI");
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /сообщение/i })).toBeDisabled();
    expect(api.reviewChat).not.toHaveBeenCalled();
    scrollHeight.mockRestore();
  });

  it("creates a tutor chat and quick prompts only fill the editor", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.createChat).mockResolvedValue({
      id: "chat-1", examId: "exam", questionId: "q-1", mode: "study", kind: "tutor",
      title: "Разбор темы", profileId: "neutral", status: "active", followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [], reviews: [],
    });
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");

    await user.click(await screen.findByRole("button", { name: /новый чат/i }));
    await user.click(screen.getByRole("button", { name: /разобрать тему/i }));
    await user.click(screen.getByRole("button", { name: /создать чат/i }));
    await user.click(await screen.findByRole("button", { name: /pizza example/i }));

    expect(screen.getByRole("textbox", { name: /сообщение/i })).toHaveValue("Explain with pizza");
    expect(api.sendTutorMessage).not.toHaveBeenCalled();
  });

  it("uses a two-panel exam workspace without profile or readiness labels", async () => {
    const api = createApi();
    vi.mocked(api.getExamRun).mockResolvedValue({
      run: {
        id: "run-1", examId: "exam", profileId: "neutral", questionCount: 1,
        currentPosition: 1, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
        items: [{ id: "i1", questionId: "q-1", position: 1, status: "active", sessionId: "session", xp: 0 }],
      },
      session: {
        id: "session", examId: "exam", questionId: "q-1", mode: "exam", kind: "exam",
        title: "Экзамен", profileId: "neutral", status: "active", followUpCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=exam&run=run-1");

    expect(await screen.findByText(/вопрос 1 из 1/i)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /навигация по вопросам/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/профиль экзаменатора/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/не начат/i)).not.toBeInTheDocument();
  });

  it("does not render a profile picker after an exam run is restored", async () => {
    let resolveExam!: (value: ExamDetail) => void;
    const api = createApi();
    const examWithProfiles = {
      ...exam,
      profiles: [
        ...exam.profiles,
        { id: "strict", name: "Strict", description: "Strict", tone: "strict" as const },
      ],
    };
    vi.mocked(api.getExam).mockReturnValue(new Promise((resolve) => {
      resolveExam = resolve;
    }));
    vi.mocked(api.getExamRun).mockResolvedValue({
      run: {
        id: "run-1",
        examId: "exam",
        profileId: "strict",
        questionCount: 1,
        currentPosition: 1,
        status: "active",
        items: [
          { id: "i1", questionId: "q-1", position: 1, status: "active", sessionId: "session", xp: 0 },
        ],
        createdAt: "2026-06-13T00:00:00.000Z",
      },
      session: {
        id: "session",
        examId: "exam",
        questionId: "q-1",
        mode: "exam",
        kind: "exam",
        title: "Экзамен",
        profileId: "strict",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z",
      },
    });

    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=exam&run=run-1");
    resolveExam(examWithProfiles);

    await screen.findByText(/вопрос 1 из 1/i);
    expect(screen.queryByLabelText(/профиль экзаменатора/i)).not.toBeInTheDocument();
  });

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
        kind: "exam",
        title: "Экзамен",
        profileId: "neutral",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z",
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
        kind: "exam",
        title: "Экзамен",
        profileId: "neutral",
        status: "active",
        followUpCount: 0,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z",
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
    await user.click(screen.getByRole("button", { name: /проверить ответ/i }));
    await user.click(await screen.findByRole("button", { name: /завершить экзамен/i }));

    expect(await screen.findByText("65/100")).toBeInTheDocument();
    expect(screen.getByText(/40 XP/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /ответ на вопрос/i })).not.toBeInTheDocument();
  });

  it("shows the reference immediately in study mode", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=study");

    expect(await screen.findByRole("heading", { level: 1, name: "What is a transaction?" })).toBeInTheDocument();
    const referencePanel = screen.getByRole("complementary", { name: /ответы и заметки/i });
    expect(within(referencePanel).getByRole("heading", { level: 2, name: question.displayText })).toBeInTheDocument();
    expect(within(referencePanel).queryByRole("heading", { name: /опорный ответ/i })).not.toBeInTheDocument();
    expect(screen.getByText(question.referenceAnswer)).toBeInTheDocument();
  });

  it("keeps answers unavailable during an active exam", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=exam");

    expect(await screen.findByText("What is a transaction?")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /ответы/i })).toBeDisabled();
    expect(screen.queryByText(question.referenceAnswer)).not.toBeInTheDocument();
  });

  it("uses two right tabs and removes the unclear package label", async () => {
    renderWorkspace(createApi(), "/exams/exam/workspace/q-1?mode=study");
    await screen.findByRole("heading", { level: 1, name: "What is a transaction?" });

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Ответы",
      "Заметки",
    ]);
    expect(screen.queryByRole("tab", { name: /источники/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/эталон пакета/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /новый чат/i })).toBeInTheDocument();
  });

  it("persists notes and bookmarks through the repository", async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderWorkspace(api, "/exams/exam/workspace/q-1?mode=study");
    await screen.findByRole("heading", { level: 1, name: "What is a transaction?" });

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
    await user.click(screen.getByRole("button", { name: /проверить ответ/i }));

    expect(await screen.findByText("Что означает атомарность?")).toBeInTheDocument();
    expect(screen.getAllByText("Что означает атомарность?")).toHaveLength(1);
    expect(editor).toHaveValue("");
    expect(screen.getAllByText("Короткий ответ")).toHaveLength(1);
  });

  it("hides readiness status after a final review and offers a fresh attempt", async () => {
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
    await user.click(screen.getByRole("button", { name: /проверить ответ/i }));

    expect(await screen.findByText("84")).toBeInTheDocument();
    expect(screen.queryByText(/попыток/i)).not.toBeInTheDocument();
    expect(editor).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /новая попытка/i }));
    expect(editor).toBeEnabled();
    expect(editor).toHaveValue("");
  });
});

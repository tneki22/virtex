import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExamApi } from "../../client/src/api.js";
import { DocumentStudy } from "../../client/src/screens/DocumentStudy.js";

function createApi(): ExamApi {
  return {
    listExams: vi.fn(),
    listMaterials: vi.fn(),
    getExam: vi.fn().mockResolvedValue({
      id: "exam",
      version: "1.0.0",
      title: "Database exam",
      description: "Fixture",
      subject: "Databases",
      profiles: [{ id: "neutral", name: "Neutral", description: "Neutral", tone: "neutral" }],
      documents: [],
      questions: [{
        id: "q-1",
        officialNumber: 1,
        officialText: "Explain ACID",
        displayText: "Explain ACID",
        groupId: "core",
        groupTitle: "Core",
        emphasis: ["ACID"],
        sources: [{ documentId: "book", page: 7, fragmentId: "book-p7-f1" }],
      }],
      thresholds: { almostReady: 60, ready: 80 },
      policy: { timerMinutes: null, maxFollowUps: 2, referenceReveal: "after_attempt_or_explicit" },
      styleGuide: "Be precise",
    }),
    getQuestion: vi.fn(),
    getDocument: vi.fn(),
    createSession: vi.fn(),
    createExamRun: vi.fn(),
    getExamRun: vi.fn(),
    advanceExamRun: vi.fn(),
    cancelExamRun: vi.fn(),
    listChats: vi.fn(),
    createChat: vi.fn(),
    getChat: vi.fn().mockResolvedValue({
      id: "chat-1",
      examId: "exam",
      mode: "study",
      kind: "document",
      scopeType: "document",
      documentId: "book",
      title: "Book",
      profileId: "neutral",
      status: "active",
      followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      reviews: [],
    }),
    sendTutorMessage: vi.fn().mockResolvedValue({
      user: {
        id: "m1",
        sessionId: "chat-1",
        role: "user",
        content: "Explain ACID",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      assistant: {
        id: "m2",
        sessionId: "chat-1",
        role: "assistant",
        content: "ACID is a set of transaction guarantees.",
        createdAt: "2026-01-01T00:00:01.000Z",
        sources: [{
          documentId: "book",
          page: 7,
          fragmentId: "book-p7-f1",
          quote: "ACID means atomicity consistency isolation durability.",
          score: 0.92,
        }, {
          documentId: "book",
          page: 7,
          fragmentId: "book-p7-f2",
          quote: "Transactions are atomic.",
          score: 0.87,
        }, {
          documentId: "book",
          page: 8,
          fragmentId: "book-p8-f1",
          quote: "Durability survives failures.",
          score: 0.73,
        }],
      },
      title: "Explain ACID",
      updatedAt: "2026-01-01T00:00:01.000Z",
    }),
    reviewChat: vi.fn(),
    transcribe: vi.fn().mockResolvedValue({ text: "Spoken document question", model: "mock-whisper" }),
    sendMessage: vi.fn(),
    review: vi.fn(),
    updateNote: vi.fn(),
    updateBookmark: vi.fn(),
    getHistory: vi.fn(),
    getExamHistory: vi.fn(),
    getAISettings: vi.fn().mockResolvedValue({
      keys: {
        openrouter: { configured: true, source: "environment" },
        groq: { configured: true, source: "environment" },
      },
      text: {
        provider: "openrouter",
        model: "openai/gpt-5-mini",
        available: true,
        streamingPreference: "off",
        streamingAvailable: false,
      },
      embeddings: {
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        available: true,
      },
      speech: { provider: "disabled", model: "", available: false },
    }),
    updateAISettings: vi.fn(),
    testAIText: vi.fn(),
    testAISpeech: vi.fn(),
    getPromptSettings: vi.fn(),
    updatePromptSettings: vi.fn(),
    listDocumentStudyDocuments: vi.fn().mockResolvedValue([
      {
        id: "book",
        title: "Book",
        type: "pdf",
        path: "book.pdf",
        pageCount: 10,
        role: "textbook",
        searchable: true,
        indexStatus: { state: "missing" },
      },
    ]),
    prepareDocumentIndex: vi.fn().mockResolvedValue({
      state: "ready",
      indexedFragments: 12,
      embeddingModel: "openai/text-embedding-3-small",
    }),
    listDocumentChats: vi.fn().mockResolvedValue([]),
    createDocumentChat: vi.fn().mockResolvedValue({
      id: "chat-1",
      examId: "exam",
      mode: "study",
      kind: "document",
      scopeType: "document",
      documentId: "book",
      title: "Book",
      profileId: "neutral",
      status: "active",
      followUpCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      reviews: [],
    }),
  };
}

describe("DocumentStudy", () => {
  it("prepares a document index, starts a chat, and renders retrieved sources", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <MemoryRouter initialEntries={["/exams/exam/document-study"]}>
        <Routes>
          <Route path="/exams/:examId/document-study" element={<DocumentStudy api={api} />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /book/i }));
    expect(screen.getByRole("separator", { name: /списка документов/i })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: /истории чатов/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /подготовить поиск/i }));
    await user.click(await screen.findByRole("button", { name: /новый чат по документу/i }));
    expect(screen.getByRole("button", { name: /диктовать/i })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /сообщение/i }), "Explain ACID");
    await user.click(screen.getByRole("button", { name: /отправить сообщение/i }));

    expect(await screen.findByText("ACID is a set of transaction guarantees.")).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: /страницы источников/i });
    expect(within(sources).getAllByText("Стр. 7")).toHaveLength(1);
    expect(within(sources).getByText("Стр. 8")).toBeInTheDocument();
    expect(within(sources).queryByText("book-p7-f1")).not.toBeInTheDocument();
    expect(within(sources).queryByText("92%")).not.toBeInTheDocument();
    expect(api.prepareDocumentIndex).toHaveBeenCalledWith("exam", "book");
    expect(api.createDocumentChat).toHaveBeenCalledWith({
      examId: "exam",
      documentId: "book",
      profileId: "neutral",
    });
  });

  it("disables index preparation when embeddings are unavailable", async () => {
    const api = createApi();
    vi.mocked(api.listDocumentStudyDocuments).mockResolvedValue([
      {
        id: "book",
        title: "Book",
        type: "pdf",
        path: "book.pdf",
        pageCount: 10,
        role: "textbook",
        searchable: true,
        indexStatus: {
          state: "unavailable",
          message: "Embedding provider is not configured",
        },
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/exams/exam/document-study"]}>
        <Routes>
          <Route path="/exams/:examId/document-study" element={<DocumentStudy api={api} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/embedding provider is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /подготовить поиск/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /новый чат по документу/i })).toBeDisabled();
  });

  it("selects a ready indexed document when one is already persisted", async () => {
    const api = createApi();
    vi.mocked(api.listDocumentStudyDocuments).mockResolvedValue([
      {
        id: "answers",
        title: "Answers",
        type: "pdf",
        path: "answers.pdf",
        pageCount: 44,
        role: "answers",
        searchable: true,
        indexStatus: { state: "missing" },
      },
      {
        id: "book",
        title: "Book",
        type: "pdf",
        path: "book.pdf",
        pageCount: 10,
        role: "textbook",
        searchable: true,
        indexStatus: {
          state: "ready",
          indexedFragments: 12,
          embeddingModel: "openai/text-embedding-3-small",
        },
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/exams/exam/document-study"]}>
        <Routes>
          <Route path="/exams/:examId/document-study" element={<DocumentStudy api={api} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Book" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /новый чат по документу/i })).toBeEnabled();
    expect(api.listDocumentChats).toHaveBeenCalledWith("exam", "book");
  });

  it("renders streamed document tutor deltas before the final turn is persisted", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.getAISettings).mockResolvedValue({
      keys: {
        openrouter: { configured: true, source: "environment" },
        groq: { configured: true, source: "environment" },
      },
      text: {
        provider: "openrouter",
        model: "openai/gpt-5-mini",
        available: true,
        streamingPreference: "auto",
        streamingAvailable: true,
      },
      embeddings: {
        provider: "openrouter",
        model: "openai/text-embedding-3-small",
        available: true,
      },
      speech: { provider: "disabled", model: "", available: false },
    });
    let finishStream: (() => void) | undefined;
    vi.mocked(api.sendTutorMessage).mockImplementation((_chatId, _content, options) => {
      options?.onDelta?.("Partial ");
      return new Promise((resolve) => {
        finishStream = () => resolve({
          user: {
            id: "m1",
            sessionId: "chat-1",
            role: "user",
            content: "Explain ACID",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          assistant: {
            id: "m2",
            sessionId: "chat-1",
            role: "assistant",
            content: "Partial final answer.",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          title: "Explain ACID",
          updatedAt: "2026-01-01T00:00:01.000Z",
        });
      });
    });

    render(
      <MemoryRouter initialEntries={["/exams/exam/document-study"]}>
        <Routes>
          <Route path="/exams/:examId/document-study" element={<DocumentStudy api={api} />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: /book/i }));
    await user.click(screen.getByRole("button", { name: /подготовить поиск/i }));
    await user.click(await screen.findByRole("button", { name: /новый чат по документу/i }));
    await user.type(screen.getByRole("textbox", { name: /сообщение/i }), "Explain ACID");
    await user.click(screen.getByRole("button", { name: /отправить сообщение/i }));

    expect(await screen.findByText("Partial")).toBeInTheDocument();
    expect(api.sendTutorMessage).toHaveBeenCalledWith("chat-1", "Explain ACID", expect.objectContaining({
      stream: true,
      onDelta: expect.any(Function),
    }));

    await act(async () => {
      finishStream?.();
    });

    expect(await screen.findByText("Partial final answer.")).toBeInTheDocument();
  });
});

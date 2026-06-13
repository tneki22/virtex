import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExamApi, ExamDetail } from "../../client/src/api.js";
import { ExamOverview } from "../../client/src/screens/ExamOverview.js";

const exam: ExamDetail = {
  id: "database-fundamentals",
  version: "1.0.0",
  title: "Базы данных: экзамен",
  description: "Полное описание пакета",
  subject: "Базы данных",
  profiles: [
    { id: "neutral", name: "Нейтральный", description: "Без давления", tone: "neutral" },
  ],
  documents: [
    { id: "answers", title: "Ответы", type: "pdf", path: "answers.pdf", pageCount: 30 },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "Первый вопрос",
      displayText: "Первый вопрос",
      groupId: "core",
      groupTitle: "Основы",
      emphasis: [],
      sources: [{ documentId: "answers", page: 1 }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: {
    timerMinutes: null,
    maxFollowUps: 2,
    referenceReveal: "after_attempt_or_explicit",
  },
  styleGuide: "Пиши точно.",
};

function createApi(): ExamApi {
  return {
    listExams: vi.fn(),
    getExam: vi.fn().mockResolvedValue(exam),
    getQuestion: vi.fn(),
    getDocument: vi.fn(),
    createSession: vi.fn(),
    createExamRun: vi.fn(),
    getExamRun: vi.fn(),
    advanceExamRun: vi.fn(),
    listChats: vi.fn(),
    createChat: vi.fn(),
    getChat: vi.fn(),
    sendTutorMessage: vi.fn(),
    reviewChat: vi.fn(),
    transcribe: vi.fn(),
    sendMessage: vi.fn(),
    review: vi.fn(),
    updateNote: vi.fn(),
    updateBookmark: vi.fn(),
    getHistory: vi.fn(),
    testAI: vi.fn(),
    getSettingsStatus: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={[`/exams/${exam.id}`]}>
      <Routes>
        <Route path="/exams/:examId" element={<ExamOverview api={createApi()} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExamOverview", () => {
  it("shows only study and exam entry points", async () => {
    renderOverview();

    expect(await screen.findByRole("link", { name: /изучение/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /открыть экзамен/i })).toBeInTheDocument();
    expect(screen.queryByText(/практика/i)).not.toBeInTheDocument();
    expect(screen.queryByText(exam.description)).not.toBeInTheDocument();
    expect(screen.queryByText(/источники/i)).not.toBeInTheDocument();
  });

  it("offers exactly 1, 2, 3, or 5 exam questions", async () => {
    const user = userEvent.setup();
    renderOverview();
    await screen.findByRole("button", { name: /открыть экзамен/i });

    const options = screen.getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("value"))).toEqual(["1", "2", "3", "5"]);
    expect(screen.getByRole("radio", { name: "1" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "3" }));
    await user.click(screen.getByRole("button", { name: /открыть экзамен/i }));
    expect(screen.getByLabelText("location")).toHaveTextContent(
      `/exams/${exam.id}/workspace/random?mode=exam&count=3`,
    );
  });
});

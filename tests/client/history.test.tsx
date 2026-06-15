import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ExamApi } from "../../client/src/api.js";
import { ExamHistory } from "../../client/src/screens/ExamHistory.js";
import { History } from "../../client/src/screens/History.js";

function createApi() {
  return {
    getHistory: vi.fn().mockResolvedValue({
      examRuns: [{
        runId: "run-1",
        examId: "exam",
        examTitle: "Экзамен по базам данных",
        questionCount: 2,
        averageScore: 82,
        totalXp: 35,
        completedAt: "2026-06-14T10:00:00.000Z",
      }],
      studyAttempts: [{
        id: "attempt-1",
        sessionId: "study-1",
        questionId: "q-1",
        examId: "exam",
        questionTitle: "Транзакции",
        answer: "Учебный ответ",
        baseScore: 76,
        xp: 10,
        createdAt: "2026-06-13T10:00:00.000Z",
        review: {
          action: "final",
          examinerMessage: "Учебный отзыв",
          baseScore: 76,
          personaVerdict: "Почти готов",
          strengths: ["Определение"],
          gaps: [],
          errors: [],
          citations: [],
          advice: "Повторить свойства",
          packageVersion: "1",
          promptVersion: "1",
          schemaVersion: "1",
        },
      }],
    }),
    getExamHistory: vi.fn().mockResolvedValue({
      summary: {
        runId: "run-1",
        examId: "exam",
        examTitle: "Экзамен по базам данных",
        questionCount: 2,
        averageScore: 82,
        totalXp: 35,
        completedAt: "2026-06-14T10:00:00.000Z",
      },
      items: [{
        position: 1,
        questionId: "q-1",
        questionTitle: "Транзакции",
        officialText: "Раскройте понятие транзакции",
        answer: "Полный экзаменационный ответ",
        baseScore: 82,
        xp: 20,
        review: {
          action: "final",
          examinerMessage: "Финальный отзыв экзаменатора",
          baseScore: 82,
          personaVerdict: "Готов",
          strengths: ["Точное определение"],
          gaps: [],
          errors: [],
          citations: [],
          advice: "Сохранить темп",
          packageVersion: "1",
          promptVersion: "1",
          schemaVersion: "1",
        },
      }],
    }),
  } as unknown as ExamApi;
}

describe("History", () => {
  it("shows grouped history and opens a completed exam detail", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <Routes>
          <Route path="/history" element={<History api={api} />} />
          <Route path="/history/exams/:runId" element={<ExamHistory api={api} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Экзамены" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Учебные проверки" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /экзамен по базам данных/i })).toHaveTextContent("82/100");
    expect(screen.getByText("Учебный отзыв")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /экзамен по базам данных/i }));
    expect(await screen.findByText("Полный экзаменационный ответ")).toBeInTheDocument();
    expect(screen.getByText("Финальный отзыв экзаменатора")).toBeInTheDocument();
    expect(screen.getByText("Раскройте понятие транзакции")).toBeInTheDocument();
  });

  it("renders loading and error states", async () => {
    const api = createApi();
    vi.mocked(api.getHistory).mockRejectedValue(new Error("История недоступна"));
    render(<MemoryRouter><History api={api} /></MemoryRouter>);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("История недоступна");
  });
});

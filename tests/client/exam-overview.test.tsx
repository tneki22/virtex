import { render, screen, waitFor } from "@testing-library/react";
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
    cancelExamRun: vi.fn(),
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
    getExamHistory: vi.fn(),
    getAISettings: vi.fn().mockResolvedValue({
      keys: {
        openrouter: { configured: true, source: "environment" },
        groq: { configured: true, source: "environment" },
      },
      text: { provider: "openrouter", model: "openai/gpt-5-mini", available: true },
      speech: { provider: "groq", model: "whisper-large-v3-turbo", available: true },
    }),
    updateAISettings: vi.fn().mockImplementation(async (input) => ({
      keys: {
        openrouter: { configured: true, source: "environment" },
        groq: { configured: true, source: input.groqApiKey ? "application" : "environment" },
      },
      text: { provider: input.textProvider, model: input.textModel, available: true },
      speech: { provider: input.speechProvider, model: input.speechModel, available: true },
    })),
    testAIText: vi.fn(),
    testAISpeech: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function renderOverview(api = createApi()) {
  return render(
    <MemoryRouter initialEntries={[`/exams/${exam.id}`]}>
      <Routes>
        <Route path="/exams/:examId" element={<ExamOverview api={api} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExamOverview", () => {
  it("shows only study and exam entry points", async () => {
    renderOverview();

    expect(await screen.findByRole("link", { name: /история/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /изучение/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /открыть экзамен/i })).toBeInTheDocument();
    expect(screen.queryByText(/практика/i)).not.toBeInTheDocument();
    expect(screen.queryByText(exam.description)).not.toBeInTheDocument();
    expect(screen.queryByText(/источники/i)).not.toBeInTheDocument();
  });

  it("opens history from the top-right action", async () => {
    const user = userEvent.setup();
    renderOverview();

    await user.click(await screen.findByRole("link", { name: /история/i }));

    expect(screen.getByLabelText("location")).toHaveTextContent("/history");
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

  it("configures text and speech providers independently without resending empty keys", async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderOverview(api);

    expect(await screen.findByText(/OpenRouter: ключ из окружения/i)).toBeInTheDocument();
    expect(screen.getByText(/GroqCloud: ключ из окружения/i)).toBeInTheDocument();
    expect(screen.getByText(/Текст: OpenRouter · openai\/gpt-5-mini/i)).toBeInTheDocument();
    expect(screen.getByText(/Речь: GroqCloud · whisper-large-v3-turbo/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Провайдер текста"), "groq");
    await user.clear(screen.getByLabelText("Модель текста"));
    await user.type(screen.getByLabelText("Модель текста"), "llama-3.3-70b-versatile");
    await user.selectOptions(screen.getByLabelText("Провайдер речи"), "openrouter");
    await user.clear(screen.getByLabelText("Модель речи"));
    await user.type(screen.getByLabelText("Модель речи"), "openai/whisper-large-v3");
    await user.type(screen.getByLabelText("Новый ключ GroqCloud"), "new-groq-key");
    await user.click(screen.getByRole("button", { name: "Сохранить AI-настройки" }));

    expect(api.updateAISettings).toHaveBeenCalledWith({
      textProvider: "groq",
      textModel: "llama-3.3-70b-versatile",
      speechProvider: "openrouter",
      speechModel: "openai/whisper-large-v3",
      groqApiKey: "new-groq-key",
    });
  });

  it("clears only the selected application key override", async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderOverview(api);
    await screen.findByText(/OpenRouter: ключ из окружения/i);

    await user.click(screen.getAllByRole("button", { name: "Использовать ключ окружения" })[0]);
    await user.click(screen.getByRole("button", { name: "Сохранить AI-настройки" }));

    expect(api.updateAISettings).toHaveBeenCalledWith(expect.objectContaining({
      clearOpenrouterApiKey: true,
    }));
    expect(api.updateAISettings).toHaveBeenCalledWith(expect.not.objectContaining({
      clearGroqApiKey: true,
    }));
  });

  it("marks AI settings busy while saving", async () => {
    const user = userEvent.setup();
    const api = createApi();
    let resolveUpdate!: (value: Awaited<ReturnType<ExamApi["updateAISettings"]>>) => void;
    vi.mocked(api.updateAISettings).mockImplementation(() => new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    const { container } = renderOverview(api);
    await screen.findByText(/OpenRouter:/i);

    const section = container.querySelector(".ai-settings-section");
    const saveButton = container.querySelector<HTMLButtonElement>(".ai-settings-save");
    expect(section).not.toBeNull();
    expect(saveButton).not.toBeNull();
    await user.click(saveButton!);

    expect(section).toHaveAttribute("aria-busy", "true");
    resolveUpdate(await createApi().getAISettings());
    await waitFor(() => expect(section).toHaveAttribute("aria-busy", "false"));
  });

  it("announces AI connection test results", async () => {
    const user = userEvent.setup();
    const api = createApi();
    vi.mocked(api.testAIText).mockResolvedValue({
      ok: true,
      provider: "openrouter",
      model: "openai/gpt-5-mini",
      message: "Connected",
    });
    const { container } = renderOverview(api);
    await screen.findByText(/OpenRouter:/i);

    const testButton = container.querySelector<HTMLButtonElement>(".ai-task-card .secondary-button");
    expect(testButton).not.toBeNull();
    await user.click(testButton!);

    expect(await screen.findByRole("status")).toHaveClass("connection-result", "ok");
  });
});

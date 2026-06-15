import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../client/src/App.js";
import { AppShell } from "../../client/src/components/AppShell.js";

describe("AppShell", () => {
  it("renders application content without a global header", () => {
    render(
      <MemoryRouter>
        <AppShell><main>Содержимое страницы</main></AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByText("Содержимое страницы")).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("redirects the removed settings route to the overview", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings/ai") {
        return new Response(JSON.stringify({
          keys: {
            openrouter: { configured: true, source: "environment" },
            groq: { configured: true, source: "environment" },
          },
          text: { provider: "openrouter", model: "openai/gpt-5-mini", available: true },
          speech: { provider: "groq", model: "whisper-large-v3-turbo", available: true },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        id: "database-fundamentals",
        version: "1",
        title: "Базы данных",
        description: "Экзамен",
        subject: "Базы данных",
        profiles: [{ id: "neutral", name: "Нейтральный", description: "", tone: "neutral" }],
        documents: [],
        questions: [{
          id: "q-1", officialNumber: 1, officialText: "Вопрос", displayText: "Вопрос",
          groupId: "core", groupTitle: "Основы", emphasis: [], sources: [],
        }],
        thresholds: { almostReady: 60, ready: 80 },
        policy: { timerMinutes: null, maxFollowUps: 2, referenceReveal: "after_attempt_or_explicit" },
        styleGuide: "Точно",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<MemoryRouter initialEntries={["/settings"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Выберите режим" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Настройки" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

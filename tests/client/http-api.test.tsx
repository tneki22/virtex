import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpExamApi } from "../../client/src/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpExamApi", () => {
  it("reports an outdated or unavailable API when a JSON endpoint returns HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "<!DOCTYPE html><html><body>Cannot GET /api/settings/ai</body></html>",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    )));

    await expect(new HttpExamApi().getAISettings()).rejects.toThrow(
      "Сервер API недоступен или запущена устаревшая версия",
    );
  });

  it("reports an outdated API when history uses the legacy response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      attempts: [],
      reviews: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(new HttpExamApi().getHistory()).rejects.toThrow(
      "Сервер API недоступен или запущена устаревшая версия",
    );
  });

  it("uses the exam cancellation and history detail endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        summary: {
          runId: "run-1",
          examId: "exam",
          examTitle: "Exam",
          questionCount: 1,
          averageScore: 84,
          totalXp: 20,
          completedAt: "2026-06-14T10:00:00.000Z",
        },
        items: [],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpExamApi();

    await api.cancelExamRun("run-1");
    await expect(api.getExamHistory("run-1")).resolves.toMatchObject({
      summary: { runId: "run-1" },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/exam-runs/run-1", expect.objectContaining({
      method: "DELETE",
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/history/exams/run-1", expect.anything());
  });
});

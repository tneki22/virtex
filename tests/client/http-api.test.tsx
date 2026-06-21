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

  it("loads exam materials from the materials endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { name: "guide.pdf", size: 1200, url: "/materials/guide.pdf" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new HttpExamApi().listMaterials()).resolves.toEqual([
      { name: "guide.pdf", size: 1200, url: "/materials/guide.pdf" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/materials", expect.anything());
  });

  it("uses document study endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
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
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "ready",
        indexedFragments: 12,
        embeddingModel: "openai/text-embedding-3-small",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new HttpExamApi();

    await expect(api.listDocumentStudyDocuments("exam")).resolves.toEqual([
      expect.objectContaining({ id: "book", indexStatus: { state: "missing" } }),
    ]);
    await expect(api.prepareDocumentIndex("exam", "book")).resolves.toMatchObject({
      state: "ready",
    });
    await expect(api.listDocumentChats("exam", "book")).resolves.toEqual([]);
    await expect(api.createDocumentChat({
      examId: "exam",
      documentId: "book",
      profileId: "neutral",
    })).resolves.toMatchObject({ id: "chat-1", documentId: "book" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/exams/exam/document-study/documents",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/exams/exam/documents/book/index",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/exams/exam/documents/book/chats",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/exams/exam/documents/book/chats",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("streams tutor messages over NDJSON and reports deltas", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "chunk", delta: "First " })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "chunk", delta: "chunk" })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "done",
          user: {
            id: "m-user",
            sessionId: "chat-1",
            role: "user",
            content: "Explain",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          assistant: {
            id: "m-assistant",
            sessionId: "chat-1",
            role: "assistant",
            content: "First chunk",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          title: "Explain",
          updatedAt: "2026-01-01T00:00:01.000Z",
        })}\n`));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    }));
    const deltas: string[] = [];
    vi.stubGlobal("fetch", fetchMock);

    const result = await new HttpExamApi().sendTutorMessage("chat-1", "Explain", {
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["First ", "chunk"]);
    expect(result.assistant.content).toBe("First chunk");
    expect(fetchMock).toHaveBeenCalledWith("/api/chats/chat-1/messages/stream", expect.objectContaining({
      method: "POST",
    }));
  });
});

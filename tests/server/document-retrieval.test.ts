import { describe, expect, it } from "vitest";
import type { ExamPackage } from "../../shared/contracts.js";
import { createDatabase } from "../../server/database.js";
import { DocumentRetrievalService } from "../../server/document-retrieval.js";
import type { EmbeddingProvider } from "../../server/ai.js";

const exam: ExamPackage = {
  id: "exam",
  version: "1.0.0",
  title: "Database exam",
  description: "Fixture",
  subject: "Databases",
  profiles: [{ id: "neutral", name: "Neutral", description: "Neutral", tone: "neutral" }],
  documents: [
    {
      id: "answers",
      title: "Answers",
      type: "text",
      path: "answers.txt",
      pageCount: 1,
      role: "answers",
      searchable: true,
      fragments: [
        { id: "answers-p1-f1", page: 1, text: "Reference answer about normal forms." },
      ],
    },
    {
      id: "book",
      title: "Textbook",
      type: "text",
      path: "book.txt",
      pageCount: 2,
      role: "textbook",
      searchable: true,
      fragments: [
        { id: "book-p1-f1", page: 1, text: "Transactions group database changes." },
        { id: "book-p1-f2", page: 1, text: "ACID means atomicity consistency isolation durability." },
        { id: "book-p2-f1", page: 2, text: "Indexes speed up search operations." },
      ],
    },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "Explain ACID",
      displayText: "Explain ACID",
      groupId: "core",
      groupTitle: "Core",
      referenceAnswer: "ACID describes transaction guarantees.",
      emphasis: [],
      sources: [{ documentId: "answers", page: 1, fragmentId: "answers-p1-f1" }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: { timerMinutes: null, maxFollowUps: 2, referenceReveal: "after_attempt_or_explicit" },
  styleGuide: "Be precise.",
};

class KeywordEmbeddingProvider implements EmbeddingProvider {
  readonly model = "test-embedding";

  async embed(input: string[]): Promise<number[][]> {
    return input.map((text) => {
      const normalized = text.toLocaleLowerCase("en");
      return [
        normalized.includes("acid") || normalized.includes("atomicity") ? 1 : 0,
        normalized.includes("transaction") || normalized.includes("transactions") ? 1 : 0,
        normalized.includes("index") || normalized.includes("search") ? 1 : 0,
      ];
    });
  }
}

describe("DocumentRetrievalService", () => {
  it("builds a local vector index and retrieves only from the selected document", async () => {
    const database = createDatabase(":memory:");
    const service = new DocumentRetrievalService({
      database,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });

    expect(service.status(exam, "book")).toMatchObject({ state: "missing" });

    await service.prepare(exam, "book");

    expect(service.status(exam, "book")).toMatchObject({
      state: "ready",
      indexedFragments: 3,
      embeddingModel: "test-embedding",
    });
    const results = await service.retrieve(exam, "book", "What does ACID require?");

    expect(results.map((result) => result.fragmentId)).toContain("book-p1-f2");
    expect(results.every((result) => result.documentId === "book")).toBe(true);
    expect(results.some((result) => (result.text ?? "").includes("Reference answer"))).toBe(false);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("expands top matches into ordered neighbor blocks without duplicates", async () => {
    const expandedExam: ExamPackage = {
      ...exam,
      documents: exam.documents.map((document) => document.id === "book"
        ? {
            ...document,
            pageCount: 6,
            fragments: Array.from({ length: 6 }, (_, index) => ({
              id: `book-p${index + 1}-f1`,
              page: index + 1,
              text: `Transaction topic part ${index + 1}.`,
            })),
          }
        : document),
    };
    const database = createDatabase(":memory:");
    const service = new DocumentRetrievalService({
      database,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });
    await service.prepare(expandedExam, "book");

    const results = await service.retrieve(expandedExam, "book", "transaction", {
      topK: 2,
      neighborWindow: 2,
      maxContextCharacters: 10_000,
    });

    expect(results.map((result) => result.fragmentId)).toEqual([
      "book-p1-f1",
      "book-p2-f1",
      "book-p3-f1",
      "book-p4-f1",
    ]);
    expect(new Set(results.map((result) => result.fragmentId)).size).toBe(results.length);
  });

  it("honors the expanded context character budget while building retrieval blocks", async () => {
    const expandedExam: ExamPackage = {
      ...exam,
      documents: exam.documents.map((document) => document.id === "book"
        ? {
            ...document,
            fragments: Array.from({ length: 20 }, (_, index) => ({
              id: `book-p1-f${index + 1}`,
              page: 1,
              text: `Transaction section ${index + 1}. ${"x".repeat(900)}`,
            })),
          }
        : document),
    };
    const database = createDatabase(":memory:");
    const service = new DocumentRetrievalService({
      database,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });
    await service.prepare(expandedExam, "book");

    const results = await service.retrieve(expandedExam, "book", "transaction", {
      topK: 10,
      neighborWindow: 2,
      maxContextCharacters: 16_000,
    });

    expect(results.length).toBeGreaterThan(10);
    expect(results.reduce((sum, result) => sum + (result.text ?? "").length, 0)).toBeLessThanOrEqual(16_000);
  });

  it("marks an index stale when document fragments change", async () => {
    const database = createDatabase(":memory:");
    const service = new DocumentRetrievalService({
      database,
      embeddingProvider: new KeywordEmbeddingProvider(),
    });
    await service.prepare(exam, "book");

    const changed: ExamPackage = {
      ...exam,
      documents: exam.documents.map((document) => document.id === "book"
        ? {
            ...document,
            fragments: [
              ...(document.fragments ?? []),
              { id: "book-p2-f2", page: 2, text: "New fragment about query planning." },
            ],
          }
        : document),
    };

    expect(service.status(changed, "book")).toMatchObject({ state: "stale" });
  });
});

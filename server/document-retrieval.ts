import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  DocumentIndexStatus,
  ExamPackage,
  RetrievedSourceReference,
  SourceDocument,
  SourceFragment,
} from "../shared/contracts.js";
import type { EmbeddingProvider } from "./ai.js";

interface RagDocumentRow {
  content_hash: string;
  fragment_count: number;
  indexed_at: string;
}

interface RagEmbeddingRow {
  fragment_id: string;
  page: number;
  ordinal: number;
  vector: Buffer;
}

interface RetrievalOptions {
  topK?: number;
  neighborWindow?: number;
  maxContextCharacters?: number;
}

export class DocumentRetrievalService {
  constructor(private readonly options: {
    database: Database.Database;
    embeddingProvider: EmbeddingProvider | null;
    now?: () => Date;
  }) {}

  status(exam: ExamPackage, documentId: string): DocumentIndexStatus {
    const provider = this.options.embeddingProvider;
    if (!provider) {
      return { state: "unavailable", message: "Embedding provider is not configured" };
    }
    const document = findDocument(exam, documentId);
    const fragments = searchableFragments(document);
    const row = this.options.database.prepare(`
      SELECT content_hash, fragment_count, indexed_at
      FROM rag_documents
      WHERE exam_id = ? AND package_version = ? AND document_id = ? AND embedding_model = ?
    `).get(exam.id, exam.version, document.id, provider.model) as RagDocumentRow | undefined;
    if (!row) return { state: "missing" };
    const currentHash = documentHash(document);
    if (row.content_hash !== currentHash || row.fragment_count !== fragments.length) {
      return {
        state: "stale",
        indexedFragments: row.fragment_count,
        embeddingModel: provider.model,
        updatedAt: row.indexed_at,
      };
    }
    return {
      state: "ready",
      indexedFragments: row.fragment_count,
      embeddingModel: provider.model,
      updatedAt: row.indexed_at,
    };
  }

  async prepare(exam: ExamPackage, documentId: string): Promise<DocumentIndexStatus> {
    const provider = this.requireProvider();
    const document = findDocument(exam, documentId);
    const fragments = searchableFragments(document);
    const embeddings: number[][] = [];
    const batchSize = 32;
    for (let index = 0; index < fragments.length; index += batchSize) {
      const batch = fragments.slice(index, index + batchSize);
      embeddings.push(...await provider.embed(batch.map((fragment) => fragment.text)));
    }
    const contentHash = documentHash(document);
    const indexedAt = (this.options.now ?? (() => new Date()))().toISOString();

    this.options.database.transaction(() => {
      this.options.database.prepare(`
        DELETE FROM rag_embeddings
        WHERE exam_id = ? AND package_version = ? AND document_id = ? AND embedding_model = ?
      `).run(exam.id, exam.version, document.id, provider.model);
      this.options.database.prepare(`
        DELETE FROM rag_documents
        WHERE exam_id = ? AND package_version = ? AND document_id = ? AND embedding_model = ?
      `).run(exam.id, exam.version, document.id, provider.model);

      const insertEmbedding = this.options.database.prepare(`
        INSERT INTO rag_embeddings
          (exam_id, package_version, document_id, fragment_id, embedding_model, page, ordinal, text_hash, vector)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      fragments.forEach((fragment, index) => {
        insertEmbedding.run(
          exam.id,
          exam.version,
          document.id,
          fragment.id,
          provider.model,
          fragment.page,
          index,
          hashText(fragment.text),
          vectorToBlob(normalizeVector(embeddings[index] ?? [])),
        );
      });
      this.options.database.prepare(`
        INSERT INTO rag_documents
          (exam_id, package_version, document_id, embedding_model, content_hash, fragment_count, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(exam.id, exam.version, document.id, provider.model, contentHash, fragments.length, indexedAt);
    })();

    return {
      state: "ready",
      indexedFragments: fragments.length,
      embeddingModel: provider.model,
      updatedAt: indexedAt,
    };
  }

  async retrieve(
    exam: ExamPackage,
    documentId: string,
    query: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievedSourceReference[]> {
    const provider = this.requireProvider();
    const document = findDocument(exam, documentId);
    const status = this.status(exam, documentId);
    if (status.state !== "ready") {
      throw Object.assign(new Error("Document index is not ready"), { status: 409 });
    }
    const [queryEmbedding] = await provider.embed([query]);
    const queryVector = normalizeVector(queryEmbedding ?? []);
    const rows = this.options.database.prepare(`
      SELECT fragment_id, page, ordinal, vector
      FROM rag_embeddings
      WHERE exam_id = ? AND package_version = ? AND document_id = ? AND embedding_model = ?
      ORDER BY ordinal
    `).all(exam.id, exam.version, document.id, provider.model) as RagEmbeddingRow[];
    const fragments = searchableFragments(document);
    const byId = new Map(fragments.map((fragment, index) => [fragment.id, { fragment, index }]));
    const scored = rows
      .map((row) => {
        const located = byId.get(row.fragment_id);
        if (!located) return undefined;
        return {
          ...located,
          score: dot(queryVector, blobToVector(row.vector)),
        };
      })
      .filter((item): item is { fragment: SourceFragment; index: number; score: number } => Boolean(item))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const selected = new Map<string, {
      fragment: SourceFragment;
      score: number;
      blockRank: number;
      seedRank: number;
      ordinal: number;
    }>();
    const topK = options.topK ?? 5;
    const neighborWindow = Math.max(0, Math.floor(options.neighborWindow ?? 1));
    scored.slice(0, topK).forEach((item, blockRank) => {
      const firstIndex = Math.max(0, item.index - neighborWindow);
      const lastIndex = Math.min(fragments.length - 1, item.index + neighborWindow);
      for (let neighborIndex = firstIndex; neighborIndex <= lastIndex; neighborIndex += 1) {
        const neighbor = fragments[neighborIndex];
        if (!neighbor) continue;
        const score = neighbor.id === item.fragment.id ? item.score : 0;
        const seedRank = neighbor.id === item.fragment.id ? 0 : 1;
        const existing = selected.get(neighbor.id);
        if (existing) {
          existing.score = Math.max(existing.score, score);
          existing.seedRank = Math.min(existing.seedRank, seedRank);
        } else {
          selected.set(neighbor.id, {
            fragment: neighbor,
            score,
            blockRank,
            seedRank,
            ordinal: neighborIndex,
          });
        }
      }
    });

    let remaining = options.maxContextCharacters ?? 6_000;
    const ordered = [...selected.values()]
      .sort((left, right) =>
        left.blockRank - right.blockRank ||
        left.seedRank - right.seedRank ||
        left.ordinal - right.ordinal
      );
    const results: RetrievedSourceReference[] = [];
    for (const item of ordered) {
      if (remaining <= 0) break;
      const text = clip(item.fragment.text, remaining);
      remaining -= text.length;
      results.push({
        documentId: document.id,
        page: item.fragment.page,
        fragmentId: item.fragment.id,
        quote: text,
        text,
        score: item.score,
      });
    }
    return results;
  }

  private requireProvider(): EmbeddingProvider {
    if (!this.options.embeddingProvider) {
      throw Object.assign(new Error("Embedding provider is not configured"), { status: 503 });
    }
    return this.options.embeddingProvider;
  }
}

function findDocument(exam: ExamPackage, documentId: string): SourceDocument {
  const document = exam.documents.find((candidate) => candidate.id === documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { status: 404 });
  return document;
}

function searchableFragments(document: SourceDocument): SourceFragment[] {
  return (document.fragments ?? []).filter((fragment) => fragment.text.trim());
}

function documentHash(document: SourceDocument): string {
  return hashText(JSON.stringify({
    id: document.id,
    path: document.path,
    fragments: searchableFragments(document).map((fragment) => ({
      id: fragment.id,
      page: fragment.page,
      text: fragment.text,
    })),
  }));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) return values.map(() => 0);
  return values.map((value) => value / magnitude);
}

function dot(left: number[], right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += left[index] * right[index];
  return sum;
}

function vectorToBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function blobToVector(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, Math.max(0, limit)).trimEnd();
}

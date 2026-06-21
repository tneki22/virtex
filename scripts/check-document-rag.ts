import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExamPackage, RetrievedSourceReference } from "../shared/contracts.js";
import type { EmbeddingProvider } from "../server/ai.js";
import { createDatabase } from "../server/database.js";
import { DEFAULT_DOCUMENT_RAG_PROFILE } from "../server/document-rag-profile.js";
import { DocumentRetrievalService } from "../server/document-retrieval.js";
import { buildDocumentTutorRequest } from "../server/prompt.js";

class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly model = "local-hash-quality-check-v1";
  calls = 0;

  async embed(input: string[]): Promise<number[][]> {
    this.calls += input.length;
    return input.map((text) => vectorize(text));
  }
}

const dimension = 512;

function vectorize(text: string) {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    addFeature(vector, token, 2);
    if (token.length >= 5) addFeature(vector, token.slice(0, 5), 2);
    for (let index = 0; index <= token.length - 3; index += 1) {
      addFeature(vector, token.slice(index, index + 3), 1);
    }
  }
  return vector;
}

function addFeature(vector: number[], feature: string, weight: number) {
  vector[hashFeature(feature) % dimension] += weight;
}

function hashFeature(feature: string) {
  let hash = 2166136261;
  for (let index = 0; index < feature.length; index += 1) {
    hash ^= feature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function includesAll(source: RetrievedSourceReference, patterns: RegExp[]) {
  const text = `${source.fragmentId ?? ""}\n${source.text ?? source.quote ?? ""}`;
  return patterns.every((pattern) => pattern.test(text));
}

async function loadCompiledExam() {
  const filePath = path.resolve(
    process.cwd(),
    "content/exams/database-fundamentals/compiled/package.json",
  );
  return JSON.parse(await readFile(filePath, "utf8")) as ExamPackage;
}

const exam = await loadCompiledExam();
const tempDirectory = await mkdtemp(path.join(tmpdir(), "virtex-rag-check-"));
const databasePath = path.join(tempDirectory, "rag.sqlite");

try {
  const provider = new HashingEmbeddingProvider();
  let database = createDatabase(databasePath);
  let service = new DocumentRetrievalService({ database, embeddingProvider: provider });

  const searchableDocuments = exam.documents.filter((document) => document.searchable === true);
  assert(
    searchableDocuments.map((document) => document.id).join(",") === "detailed-answers,textbook",
    `Unexpected searchable documents: ${searchableDocuments.map((document) => document.id).join(", ")}`,
  );

  for (const document of searchableDocuments) {
    const statusBefore = service.status(exam, document.id);
    assert(statusBefore.state === "missing", `${document.id}: expected missing index before prepare`);
    const prepared = await service.prepare(exam, document.id);
    assert(prepared.state === "ready", `${document.id}: index did not become ready`);
    assert((prepared.indexedFragments ?? 0) > 0, `${document.id}: no fragments indexed`);
  }

  const transactionResults = await service.retrieve(
    exam,
    "detailed-answers",
    "Транзакции ACID атомарность изолированность свойства транзакции",
    DEFAULT_DOCUMENT_RAG_PROFILE,
  );
  assert(transactionResults[0], "No results for transaction query in detailed answers");
  assert(
    includesAll(transactionResults[0], [/транзакц/iu, /ACID/iu]),
    `Unexpected top transaction result: ${transactionResults[0].fragmentId}`,
  );

  const indexResults = await service.retrieve(
    exam,
    "detailed-answers",
    "Ключи индексы B-дерево CREATE INDEX поиск выборка",
    DEFAULT_DOCUMENT_RAG_PROFILE,
  );
  assert(indexResults[0], "No results for index query in detailed answers");
  assert(
    includesAll(indexResults[0], [/индекс/iu, /CREATE/iu]),
    `Unexpected top index result: ${indexResults[0].fragmentId}`,
  );

  database.close();

  const freshProvider = new HashingEmbeddingProvider();
  database = createDatabase(databasePath);
  service = new DocumentRetrievalService({ database, embeddingProvider: freshProvider });
  const persistedStatus = service.status(exam, "detailed-answers");
  assert(persistedStatus.state === "ready", "Persisted detailed-answers index was not reused");
  const callsAfterStatus = freshProvider.calls;
  assert(callsAfterStatus === 0, "Status check re-embedded content instead of reading SQLite index");

  const persistedResults = await service.retrieve(
    exam,
    "detailed-answers",
    "Транзакции ACID атомарность",
    DEFAULT_DOCUMENT_RAG_PROFILE,
  );
  assert(persistedResults[0], "Persisted index returned no transaction results");
  const callsAfterRetrieval = freshProvider.calls;
  assert(callsAfterRetrieval === 1, "Retrieval should embed only the query after reopening the database");
  database.close();

  const profile = exam.profiles[0];
  const document = exam.documents.find((item) => item.id === "detailed-answers");
  assert(profile, "No profile available for prompt diagnostics");
  assert(document, "Detailed answers document is unavailable");
  const diagnosticRequest = buildDocumentTutorRequest({
    exam,
    document,
    profile,
    message: "Транзакции ACID атомарность изолированность свойства транзакции",
    dialogue: [],
    sources: transactionResults,
    ragProfile: DEFAULT_DOCUMENT_RAG_PROFILE,
  });
  const contextCharacters = transactionResults.reduce(
    (sum, source) => sum + (source.text ?? source.quote ?? "").length,
    0,
  );

  console.log([
    "Document RAG check passed",
    `searchable=${searchableDocuments.map((document) => document.id).join(",")}`,
    `transactionTop=${transactionResults[0].fragmentId} score=${transactionResults[0].score.toFixed(3)}`,
    `indexTop=${indexResults[0].fragmentId} score=${indexResults[0].score.toFixed(3)}`,
    `profile=topK:${DEFAULT_DOCUMENT_RAG_PROFILE.topK},neighborWindow:${DEFAULT_DOCUMENT_RAG_PROFILE.neighborWindow},contextChars:${DEFAULT_DOCUMENT_RAG_PROFILE.maxContextCharacters},completionTokens:${DEFAULT_DOCUMENT_RAG_PROFILE.maxCompletionTokens}`,
    `diagnostics=selected:${transactionResults.length},contextChars:${contextCharacters},estimatedInputTokens:${diagnosticRequest.estimatedInputTokens}`,
    `persistedStatus=${persistedStatus.state}`,
  ].join("\n"));
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ExamPackage,
  ExamQuestion,
  SourceDocument,
  SourceFragment,
  SourceReference,
} from "../shared/contracts.js";
import { examPackageSchema, sourceReferenceSchema } from "../shared/schemas.js";

const manifestSchema = examPackageSchema.omit({
  questions: true,
  styleGuide: true,
}).extend({
  documents: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      type: z.enum(["pdf", "markdown", "text"]),
      path: z.string().min(1),
    }),
  ).min(1),
});

const sourceInputSchema = sourceReferenceSchema.omit({ fragmentId: true }).extend({
  fragmentId: z.string().min(1).optional(),
});

const questionInputSchema = z.object({
  id: z.string().min(1),
  officialNumber: z.number().int().positive(),
  officialText: z.string().min(1),
  displayText: z.string().min(1),
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  referenceAnswer: z.string().min(1),
  emphasis: z.array(z.string().min(1)),
  sources: z.array(sourceInputSchema).min(1),
  flags: z.array(z.string().min(1)).optional(),
});

type QuestionInput = z.infer<typeof questionInputSchema>;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Document path escapes package root: ${candidate}`);
  }
}

function splitText(value: string): string[] {
  const blocks = value
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return blocks.flatMap((block) => {
    if (block.length <= 1_200) return [block];
    const chunks: string[] = [];
    for (let offset = 0; offset < block.length; offset += 1_200) {
      chunks.push(block.slice(offset, offset + 1_200).trim());
    }
    return chunks.filter(Boolean);
  });
}

function createFragments(
  documentId: string,
  pages: Array<{ page: number; text: string }>,
): SourceFragment[] {
  return pages.flatMap(({ page, text }) =>
    splitText(text).map((fragmentText, index) => ({
      id: `${documentId}-p${page}-f${index + 1}`,
      page,
      text: fragmentText,
    })),
  );
}

async function extractPdfPages(filePath: string): Promise<Array<{ page: number; text: string }>> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data: bytes, useWorkerFetch: false }).promise;
  const pages: Array<{ page: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ page: pageNumber, text });
  }

  return pages;
}

async function compileDocument(
  packageRoot: string,
  input: z.infer<typeof manifestSchema>["documents"][number],
): Promise<SourceDocument> {
  const filePath = path.resolve(packageRoot, input.path);
  assertInside(packageRoot, filePath);

  let pages: Array<{ page: number; text: string }>;
  if (input.type === "pdf") {
    pages = await extractPdfPages(filePath);
  } else {
    pages = [{ page: 1, text: await readFile(filePath, "utf8") }];
  }

  return {
    ...input,
    pageCount: pages.length,
    fragments: createFragments(input.id, pages),
  };
}

function resolveSource(
  questionId: string,
  input: QuestionInput["sources"][number],
  documents: Map<string, SourceDocument>,
): SourceReference {
  const document = documents.get(input.documentId);
  if (!document) {
    throw new Error(`Question ${questionId}: document ${input.documentId} does not exist`);
  }
  if (!document.pageCount || input.page > document.pageCount) {
    throw new Error(
      `Question ${questionId}: page ${input.page} does not exist in ${input.documentId}`,
    );
  }

  const pageFragments = (document.fragments ?? []).filter(
    (fragment) => fragment.page === input.page,
  );
  let fragment = input.fragmentId
    ? pageFragments.find((candidate) => candidate.id === input.fragmentId)
    : undefined;

  if (input.fragmentId && !fragment) {
    throw new Error(`Question ${questionId}: fragment ${input.fragmentId} does not exist`);
  }

  if (input.quote) {
    const normalizedQuote = normalizeText(input.quote);
    const pageText = normalizeText(pageFragments.map((item) => item.text).join(" "));
    if (!pageText.includes(normalizedQuote)) {
      throw new Error(
        `Question ${questionId}: quote is not confirmed on page ${input.page} of ${input.documentId}`,
      );
    }
    fragment ??= pageFragments.find((candidate) =>
      normalizeText(candidate.text).includes(normalizedQuote),
    );
  }

  fragment ??= pageFragments[0];
  if (!fragment) {
    throw new Error(`Question ${questionId}: page ${input.page} has no extractable text`);
  }

  return {
    documentId: input.documentId,
    page: input.page,
    fragmentId: fragment.id,
    ...(input.note ? { note: input.note } : {}),
  };
}

export async function compileExamPackage(packageRootInput: string): Promise<ExamPackage> {
  const packageRoot = path.resolve(packageRootInput);
  const [manifestText, questionsText, styleGuide] = await Promise.all([
    readFile(path.join(packageRoot, "manifest.json"), "utf8"),
    readFile(path.join(packageRoot, "questions.json"), "utf8"),
    readFile(path.join(packageRoot, "style-guide.md"), "utf8"),
  ]);
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  const inputs = z.array(questionInputSchema).min(1).parse(JSON.parse(questionsText));

  const ids = new Set<string>();
  for (const question of inputs) {
    if (ids.has(question.id)) throw new Error(`Duplicate question ID: ${question.id}`);
    ids.add(question.id);
  }

  const documents = await Promise.all(
    manifest.documents.map((document) => compileDocument(packageRoot, document)),
  );
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const questions: ExamQuestion[] = inputs.map((question) => ({
    ...question,
    sources: question.sources.map((source) => resolveSource(question.id, source, documentMap)),
  }));

  const compiled: ExamPackage = {
    ...manifest,
    documents,
    questions,
    styleGuide: styleGuide.trim(),
  };

  return examPackageSchema.parse(compiled);
}

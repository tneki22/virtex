import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DB_MODULES, DB_QUESTIONS, QUESTION_TO_PDF_PAGE } from "../db.js";

interface ExtractedPage {
  page: number;
  text: string;
  lines: string[];
}

async function extractPdf(filePath: string): Promise<ExtractedPage[]> {
  const document = await getDocument({
    data: new Uint8Array(await readFile(filePath)),
    useWorkerFetch: false,
  }).promise;
  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let textWithLines = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      textWithLines += `${item.str}${item.hasEOL ? "\n" : " "}`;
    }
    const lines = textWithLines
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    pages.push({
      page: pageNumber,
      lines,
      text: lines.join(" "),
    });
  }

  return pages;
}

function extractOfficialQuestions(text: string): Map<number, string> {
  const questions = new Map<number, string>();
  const expression = /(\d+)\)\s*(.*?)(?=\s+\d+\)\s*|$)/gs;
  for (const match of text.matchAll(expression)) {
    questions.set(
      Number(match[1]),
      match[2].replace(/\s+([.,])/g, "$1").replace(/\s+/g, " ").trim(),
    );
  }
  return questions;
}

const root = process.cwd();
const packageRoot = path.join(root, "content", "exams", "database-fundamentals");
const [officialPages, answerPages] = await Promise.all([
  extractPdf(path.join(root, "questions.pdf")),
  extractPdf(path.join(root, "detailed_answers.pdf")),
]);
const officialQuestions = extractOfficialQuestions(
  officialPages.map((page) => page.text).join(" "),
);
const detailedAnswers = new Map<
  number,
  { page: number; answer: string }
>();

for (const page of answerPages) {
  const match = page.lines[0]?.match(/^Вопрос\s+(\d+)$/u);
  if (!match) continue;
  detailedAnswers.set(Number(match[1]), {
    page: page.page,
    answer: page.lines.slice(2).join(" "),
  });
}

if (officialQuestions.size !== 48) {
  throw new Error(`Expected 48 official questions, found ${officialQuestions.size}`);
}

const moduleTitles = new Map(DB_MODULES.map((module) => [module.id, module.title]));
const manualReferenceNumbers = new Set([19, 28, 36, 40, 45]);
const duplicateNumbers = new Set([4, 19, 13, 36, 31, 45]);

const questions = DB_QUESTIONS
  .map((question) => ({ question, number: Number(question.id.replace("q-", "")) }))
  .sort((left, right) => left.number - right.number)
  .map(({ question, number }) => {
    const detailed = detailedAnswers.get(number);
    const flags: string[] = [];
    if (manualReferenceNumbers.has(number)) flags.push("manual-reference");
    if (duplicateNumbers.has(number)) flags.push("duplicate-official-wording");
    if (number === 25) flags.push("compound-official-wording");
    if (number === 35) flags.push("corrected-display-wording");

    return {
      id: question.id,
      officialNumber: number,
      officialText: officialQuestions.get(number),
      displayText: question.title,
      groupId: question.moduleId,
      groupTitle: moduleTitles.get(question.moduleId) ?? question.moduleId,
      referenceAnswer:
        manualReferenceNumbers.has(number) || !detailed
          ? question.sampleAnswer
          : detailed.answer,
      emphasis: question.keywords,
      sources: detailed
        ? [
            {
              documentId: "detailed-answers",
              page: detailed.page,
              note: `Ответ к вопросу ${number}`,
            },
          ]
        : [
            {
              documentId: "textbook",
              page: QUESTION_TO_PDF_PAGE[question.id],
              note: `Основной раздел учебника для вопроса ${number}`,
            },
          ],
      ...(flags.length > 0 ? { flags } : {}),
    };
  });

await mkdir(packageRoot, { recursive: true });
await writeFile(
  path.join(packageRoot, "questions.json"),
  `${JSON.stringify(questions, null, 2)}\n`,
);

console.log(`Prepared ${questions.length} database exam questions`);

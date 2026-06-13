import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DB_MODULES, DB_QUESTIONS } from "../db.js";

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
const detailedAnswers = new Map<number, { page: number; answer: string }>();

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
const referenceAliasNumbers = new Set([19, 28, 36, 40, 45]);
const answerAliases = new Map<number, number>([
  [19, 4],
  [28, 23],
  [36, 13],
  [45, 31],
]);
const duplicateNumbers = new Set([4, 19, 13, 36, 31, 45]);

function answerForQuestion(
  number: number,
): { page: number; answer: string } | undefined {
  if (number === 40) {
    const compound = detailedAnswers.get(25);
    if (!compound) return undefined;
    const boundary = compound.answer.indexOf("Нереляционные базы данных");
    return {
      page: compound.page,
      answer: compound.answer
        .slice(0, boundary === -1 ? undefined : boundary)
        .trim(),
    };
  }

  return detailedAnswers.get(answerAliases.get(number) ?? number);
}

const questions = DB_QUESTIONS
  .map((question) => ({ question, number: Number(question.id.replace("q-", "")) }))
  .sort((left, right) => left.number - right.number)
  .map(({ question, number }) => {
    const detailed = answerForQuestion(number);
    if (!detailed) {
      throw new Error(`No detailed answer for question ${number}`);
    }

    const flags: string[] = [];
    if (referenceAliasNumbers.has(number)) flags.push("reference-alias");
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
      referenceAnswer: detailed.answer,
      emphasis: question.keywords,
      sources: [
        {
          documentId: "detailed-answers",
          page: detailed.page,
          note: `Эталон для вопроса ${number}`,
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

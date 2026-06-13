import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { aiReviewContentSchema } from "../shared/schemas.js";
import { OpenAICompatibleProvider } from "../server/ai.js";
import { guardInstructionOnlyAnswer } from "../server/answer-guard.js";
import { loadEnvironmentFiles } from "../server/config.js";
import { loadExamPackages } from "../server/content.js";
import { buildReviewRequest } from "../server/prompt.js";

const calibrationCaseSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["full", "partial", "incorrect", "empty", "unsupported", "prompt-injection"]),
  questionId: z.string().min(1),
  answer: z.string().min(1),
  expectedScore: z.object({
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
  }),
});

const packageRoot = path.resolve(process.argv[2] ?? "content/exams/database-fundamentals");
loadEnvironmentFiles(process.cwd());
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required for prompt calibration");

const exam = (await loadExamPackages(path.dirname(packageRoot))).find(
  (candidate) => candidate.id === path.basename(packageRoot),
);
if (!exam) throw new Error(`Compiled exam package not found: ${packageRoot}`);
const cases = z.array(calibrationCaseSchema).parse(
  JSON.parse(await readFile(path.join(packageRoot, "calibration.json"), "utf8")),
);
const provider = new OpenAICompatibleProvider({
  apiKey,
  baseUrl: process.env.OPENAI_BASE_URL,
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
});
const profile = exam.profiles.find((item) => item.id === "examiner") ?? exam.profiles[0];
const rows: Array<Record<string, string | number | boolean>> = [];

for (const item of cases) {
  const question = exam.questions.find((candidate) => candidate.id === item.questionId);
  if (!question) throw new Error(`Unknown calibration question: ${item.questionId}`);
  const request = buildReviewRequest({
    exam,
    question,
    profile,
    answer: item.answer,
    dialogue: [],
    forceFinal: true,
  });
  const guarded = guardInstructionOnlyAnswer(item.answer, question);
  let parsed = guarded
    ? aiReviewContentSchema.safeParse(guarded)
    : aiReviewContentSchema.safeParse(await provider.review(request));
  if (!parsed.success && !guarded) {
    parsed = aiReviewContentSchema.safeParse(await provider.review({ ...request, repair: true }));
  }
  const score = parsed.success ? parsed.data.baseScore : undefined;
  const passed =
    score !== undefined && score >= item.expectedScore.min && score <= item.expectedScore.max;
  rows.push({
    case: item.id,
    kind: item.kind,
    score: score ?? "invalid",
    expected: `${item.expectedScore.min}-${item.expectedScore.max}`,
    passed,
  });
}

console.table(rows);
if (rows.some((row) => !row.passed)) process.exitCode = 1;

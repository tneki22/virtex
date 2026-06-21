import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compileExamPackage } from "../../scripts/compiler.js";

const packageRoot = path.resolve(process.cwd(), "content/exams/database-fundamentals");
let exam: Awaited<ReturnType<typeof compileExamPackage>>;

describe("prompt calibration dataset", () => {
  beforeAll(async () => {
    exam = await compileExamPackage(packageRoot);
  }, 30_000);

  it("covers the six required answer classes with valid questions and score ranges", async () => {
    const cases = JSON.parse(
      await readFile(path.join(packageRoot, "calibration.json"), "utf8"),
    ) as Array<{ kind: string; questionId: string; expectedScore: { min: number; max: number } }>;

    expect(new Set(cases.map((item) => item.kind))).toEqual(
      new Set(["full", "partial", "incorrect", "empty", "unsupported", "prompt-injection"]),
    );
    expect(cases.every((item) => exam.questions.some((question) => question.id === item.questionId))).toBe(true);
    expect(
      cases.every(
        (item) =>
          item.expectedScore.min >= 0 &&
          item.expectedScore.max <= 100 &&
          item.expectedScore.min <= item.expectedScore.max,
      ),
    ).toBe(true);
  });
});

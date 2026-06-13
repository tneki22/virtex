import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileExamPackage } from "../../scripts/compiler.js";

const packageRoot = path.resolve(
  process.cwd(),
  "content/exams/database-fundamentals",
);

describe("database fundamentals package", () => {
  it("contains 48 independent, sourced questions with reference answers", async () => {
    const exam = await compileExamPackage(packageRoot);
    const ids = exam.questions.map((question) => question.id);
    const numbers = exam.questions.map((question) => question.officialNumber);

    expect(exam.questions).toHaveLength(48);
    expect(new Set(ids)).toHaveLength(48);
    expect(new Set(numbers)).toHaveLength(48);
    expect(exam.questions.every((question) => question.referenceAnswer.trim().length > 0)).toBe(
      true,
    );
    expect(exam.questions.every((question) => question.sources.length > 0)).toBe(true);
  });

  it("marks the audited duplicate, compound, typo, and manual-answer cases", async () => {
    const exam = await compileExamPackage(packageRoot);
    const byNumber = new Map(
      exam.questions.map((question) => [question.officialNumber, question]),
    );

    expect(byNumber.get(19)?.flags).toContain("manual-reference");
    expect(byNumber.get(28)?.flags).toContain("manual-reference");
    expect(byNumber.get(36)?.flags).toContain("manual-reference");
    expect(byNumber.get(40)?.flags).toContain("manual-reference");
    expect(byNumber.get(45)?.flags).toContain("manual-reference");
    expect(byNumber.get(25)?.flags).toContain("compound-official-wording");
    expect(byNumber.get(35)?.flags).toContain("corrected-display-wording");
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileExamPackage } from "../../scripts/compiler.js";

const packageRoot = path.resolve(
  process.cwd(),
  "content/exams/database-fundamentals",
);

describe("database fundamentals package", () => {
  it("provides at least four unique quick prompts for every examiner profile", async () => {
    const exam = await compileExamPackage(packageRoot);

    for (const profile of exam.profiles) {
      expect(profile.quickPrompts).toHaveLength(4);
      expect(new Set(profile.quickPrompts?.map((prompt) => prompt.id))).toHaveLength(4);
      expect(profile.quickPrompts?.every((prompt) => prompt.prompt.trim().length > 0)).toBe(true);
    }
  });

  it("uses the new typed personas and public profile names", async () => {
    const exam = await compileExamPackage(packageRoot);

    expect(exam.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      persona: profile.persona,
    }))).toEqual([
      { id: "mentor", name: "Магистр", persona: "magister" },
      { id: "examiner", name: "Фомин М.М.", persona: "fomin" },
      { id: "strict", name: "Комиссия", persona: "commission" },
    ]);
  });

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

  it("uses detailed answers as the authoritative source for every question", async () => {
    const exam = await compileExamPackage(packageRoot);
    const byNumber = new Map(
      exam.questions.map((question) => [question.officialNumber, question]),
    );

    expect(byNumber.get(19)?.sources[0]).toMatchObject({
      documentId: "detailed-answers",
      page: 5,
    });
    expect(byNumber.get(28)?.sources[0]).toMatchObject({
      documentId: "detailed-answers",
      page: 23,
    });
    expect(byNumber.get(36)?.sources[0]).toMatchObject({
      documentId: "detailed-answers",
      page: 14,
    });
    expect(byNumber.get(40)?.sources[0]).toMatchObject({
      documentId: "detailed-answers",
      page: 25,
    });
    expect(byNumber.get(45)?.sources[0]).toMatchObject({
      documentId: "detailed-answers",
      page: 30,
    });

    for (const question of exam.questions) {
      expect(question.sources[0]?.documentId).toBe("detailed-answers");
    }

    const unsupported =
      /WAL Buffer|synchronous_commit|TRUNCATE|Schema-on-Write|Schema-on-Read/u;
    for (const number of [19, 28, 36, 40, 45]) {
      expect(byNumber.get(number)?.referenceAnswer).not.toMatch(unsupported);
      expect(byNumber.get(number)?.flags).toContain("reference-alias");
    }
  });

  it("marks the audited duplicate, compound, and typo cases", async () => {
    const exam = await compileExamPackage(packageRoot);
    const byNumber = new Map(
      exam.questions.map((question) => [question.officialNumber, question]),
    );

    expect(byNumber.get(19)?.flags).toContain("duplicate-official-wording");
    expect(byNumber.get(36)?.flags).toContain("duplicate-official-wording");
    expect(byNumber.get(45)?.flags).toContain("duplicate-official-wording");
    expect(byNumber.get(25)?.flags).toContain("compound-official-wording");
    expect(byNumber.get(35)?.flags).toContain("corrected-display-wording");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertExamQuestionCount,
  calculateExamRunSummary,
  selectQuestionIds,
} from "../../shared/exam-run.js";

describe("exam run domain", () => {
  it("selects unique question IDs", () => {
    expect(selectQuestionIds(["q1", "q2", "q3", "q4"], 3, () => 0)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
    expect(() => selectQuestionIds(["q1"], 2, () => 0)).toThrow(/not enough questions/i);
  });

  it("accepts only the supported question counts", () => {
    expect(assertExamQuestionCount(5)).toBe(5);
    expect(() => assertExamQuestionCount(4)).toThrow(/1, 2, 3, or 5/i);
  });

  it("calculates a code-owned summary", () => {
    const summary = calculateExamRunSummary([
      { id: "1", questionId: "q1", position: 1, status: "completed", baseScore: 84, xp: 20 },
      { id: "2", questionId: "q2", position: 2, status: "completed", baseScore: 70, xp: 10 },
      { id: "3", questionId: "q3", position: 3, status: "completed", baseScore: 40, xp: 10 },
    ], { almostReady: 60, ready: 80 });

    expect(summary).toMatchObject({
      averageScore: 65,
      ready: 1,
      almostReady: 1,
      review: 1,
      totalXp: 40,
    });
  });
});

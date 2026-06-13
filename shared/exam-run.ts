import type {
  ExamQuestionCount,
  ExamRunItem,
  ExamRunSummary,
  ReadinessThresholds,
} from "./contracts.js";

export const ALLOWED_EXAM_QUESTION_COUNTS = [1, 2, 3, 5] as const;

export function assertExamQuestionCount(value: number): ExamQuestionCount {
  if (!ALLOWED_EXAM_QUESTION_COUNTS.includes(value as ExamQuestionCount)) {
    throw new Error("Question count must be 1, 2, 3, or 5");
  }
  return value as ExamQuestionCount;
}

export function selectQuestionIds(
  ids: string[],
  count: ExamQuestionCount,
  random: () => number = Math.random,
): string[] {
  if (ids.length < count) throw new Error("Not enough questions");
  const pool = [...ids];
  return Array.from({ length: count }, () => {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool.splice(index, 1)[0];
  });
}

export function calculateExamRunSummary(
  items: ExamRunItem[],
  thresholds: ReadinessThresholds,
): ExamRunSummary {
  const scored = items.filter((item) => item.baseScore !== undefined);
  const summary: ExamRunSummary = {
    ...(scored.length > 0
      ? { averageScore: Math.round(
          scored.reduce((total, item) => total + (item.baseScore ?? 0), 0) / scored.length,
        ) }
      : {}),
    ready: 0,
    almostReady: 0,
    review: 0,
    unscored: items.length - scored.length,
    totalXp: items.reduce((total, item) => total + item.xp, 0),
    results: items,
  };

  for (const item of scored) {
    if ((item.baseScore ?? 0) >= thresholds.ready) summary.ready += 1;
    else if ((item.baseScore ?? 0) >= thresholds.almostReady) summary.almostReady += 1;
    else summary.review += 1;
  }

  return summary;
}

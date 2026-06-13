import type { ReadinessStatus, SourceReference } from "./contracts.js";

export function readinessFromScore(score?: number): ReadinessStatus {
  if (score === undefined) return "not_started";
  if (score < 60) return "review";
  if (score < 80) return "almost_ready";
  return "ready";
}

export interface XpInput {
  submitted: boolean;
  followUpsAnswered: number;
  score?: number;
}

export function calculateXp(input: XpInput): number {
  if (!input.submitted) return 0;

  const submissionXp = 10;
  const followUpXp = Math.min(Math.max(input.followUpsAnswered, 0), 2) * 6;
  const masteryXp = input.score !== undefined && input.score >= 80 ? 10 : 0;

  return submissionXp + followUpXp + masteryXp;
}

export function sourceRefKey(reference: SourceReference): string {
  return [reference.documentId, reference.page, reference.fragmentId]
    .filter((part) => part !== undefined)
    .join(":");
}

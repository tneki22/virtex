import type { StudyMode } from "./contracts.js";

export function normalizeStudyMode(value: string | null | undefined): StudyMode {
  if (value === "exam" || value === "practice") return "exam";
  return "study";
}

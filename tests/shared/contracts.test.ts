import { describe, expect, it } from "vitest";
import {
  calculateXp,
  readinessFromScore,
  sourceRefKey,
} from "../../shared/progress.js";
import { examPackageSchema } from "../../shared/schemas.js";
import { normalizeStudyMode } from "../../shared/study-mode.js";

describe("normalizeStudyMode", () => {
  it("normalizes legacy practice links to exam", () => {
    expect(normalizeStudyMode("practice")).toBe("exam");
    expect(normalizeStudyMode("exam")).toBe("exam");
    expect(normalizeStudyMode("study")).toBe("study");
  });

  it("uses study for missing or invalid values", () => {
    expect(normalizeStudyMode(null)).toBe("study");
    expect(normalizeStudyMode("unknown")).toBe("study");
  });
});

describe("readinessFromScore", () => {
  it("maps attempts to stable readiness levels", () => {
    expect(readinessFromScore(undefined)).toBe("not_started");
    expect(readinessFromScore(0)).toBe("review");
    expect(readinessFromScore(59)).toBe("review");
    expect(readinessFromScore(60)).toBe("almost_ready");
    expect(readinessFromScore(79)).toBe("almost_ready");
    expect(readinessFromScore(80)).toBe("ready");
    expect(readinessFromScore(100)).toBe("ready");
  });
});

describe("calculateXp", () => {
  it("rewards completed actions without accepting model-provided XP", () => {
    expect(calculateXp({ submitted: true, followUpsAnswered: 2, score: 84 })).toBe(32);
    expect(calculateXp({ submitted: false, followUpsAnswered: 0 })).toBe(0);
  });
});

describe("sourceRefKey", () => {
  it("creates a stable source anchor key", () => {
    expect(sourceRefKey({ documentId: "book", page: 39, fragmentId: "book-p39-f2" })).toBe(
      "book:39:book-p39-f2",
    );
  });
});

describe("examPackageSchema", () => {
  it("rejects a question without a reference answer or source", () => {
    const result = examPackageSchema.safeParse({
      id: "sample",
      version: "1.0.0",
      title: "Sample exam",
      language: "ru",
      thresholds: { almostReady: 60, ready: 80 },
      policy: { maxFollowUps: 2, timerMinutes: null },
      examinerProfiles: [],
      documents: [],
      questions: [
        {
          id: "q-1",
          number: 1,
          group: "Basics",
          officialText: "Question",
          displayText: "Question",
          referenceAnswer: "",
          followUpFocus: [],
          sources: [],
        },
      ],
      styleGuide: "Write clearly.",
    });

    expect(result.success).toBe(false);
  });
});

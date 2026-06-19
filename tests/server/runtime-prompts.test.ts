// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createDatabase } from "../../server/database.js";
import {
  RuntimePromptService,
  defaultSystemPromptsForProfile,
} from "../../server/runtime-prompts.js";
import type { ExamPackage } from "../../shared/contracts.js";
import { runtimePromptSettingsUpdateSchema } from "../../shared/schemas.js";

const exam: ExamPackage = {
  id: "exam",
  version: "1.0.0",
  title: "Database exam",
  description: "Fixture",
  subject: "Databases",
  profiles: [
    {
      id: "mentor",
      name: "Magister",
      description: "Explains calmly",
      tone: "supportive",
      persona: "magister",
      quickPrompts: [{ id: "pizza", label: "Pizza", prompt: "Explain with pizza" }],
    },
    {
      id: "examiner",
      name: "Fomin",
      description: "Checks precisely",
      tone: "neutral",
      persona: "fomin",
    },
  ],
  documents: [
    {
      id: "book",
      title: "Book",
      type: "text",
      path: "book.txt",
      pageCount: 1,
      fragments: [{ id: "book-p1-f1", page: 1, text: "Transactions are atomic." }],
    },
  ],
  questions: [
    {
      id: "q-1",
      officialNumber: 1,
      officialText: "What is a transaction?",
      displayText: "What is a transaction?",
      groupId: "core",
      groupTitle: "Core",
      referenceAnswer: "A transaction is an atomic unit of work.",
      emphasis: ["atomic"],
      sources: [{ documentId: "book", page: 1, fragmentId: "book-p1-f1" }],
    },
  ],
  thresholds: { almostReady: 60, ready: 80 },
  policy: { timerMinutes: null, maxFollowUps: 2, referenceReveal: "after_attempt_or_explicit" },
  styleGuide: "Be precise.",
};

describe("runtimePromptSettingsUpdateSchema", () => {
  it("accepts editable profiles and rejects duplicate active profile IDs", () => {
    const prompts = defaultSystemPromptsForProfile(exam.profiles[0]);
    const valid = runtimePromptSettingsUpdateSchema.safeParse({
      profiles: [
        {
          ...exam.profiles[0],
          systemPrompts: prompts,
          quickPrompts: [{ id: "pizza", label: "Pizza", prompt: "Explain with pizza" }],
        },
      ],
    });
    expect(valid.success).toBe(true);

    const duplicate = runtimePromptSettingsUpdateSchema.safeParse({
      profiles: [
        { ...exam.profiles[0], systemPrompts: prompts, quickPrompts: [] },
        { ...exam.profiles[0], name: "Copy", systemPrompts: prompts, quickPrompts: [] },
      ],
    });
    expect(duplicate.success).toBe(false);
  });
});

describe("RuntimePromptService", () => {
  it("returns defaults, saves overrides, hides archived profiles, and can reset to defaults", () => {
    const database = createDatabase(":memory:");
    const service = new RuntimePromptService({ database });

    const initial = service.getSettings(exam);
    expect(initial.profiles.map((profile) => profile.id)).toEqual(["mentor", "examiner"]);
    expect(initial.profiles[0].systemPrompts.studyTutor).toContain("Persona:");

    const saved = service.updateSettings(exam, {
      profiles: [
        {
          ...initial.profiles[0],
          name: "Custom mentor",
          systemPrompts: {
            ...initial.profiles[0].systemPrompts,
            studyTutor: "Custom tutor instructions",
          },
        },
        { ...initial.profiles[1], archived: true },
        {
          id: "custom",
          name: "Custom examiner",
          description: "User-defined examiner",
          tone: "strict",
          quickPrompts: [{ id: "drill", label: "Drill", prompt: "Ask five short questions" }],
          systemPrompts: {
            studyTutor: "Tutor custom",
            studyReview: "Review custom",
            examFinal: "Exam custom",
          },
        },
      ],
    });

    expect(saved.profiles.map((profile) => profile.id)).toEqual(["mentor", "examiner", "custom"]);
    expect(service.activeProfiles(exam).map((profile) => profile.id)).toEqual(["mentor", "custom"]);
    expect(saved.profiles[0].name).toBe("Custom mentor");
    expect(saved.profiles[2].quickPrompts).toHaveLength(1);
    expect(service.resolveProfile(exam, "examiner")).toMatchObject({
      id: "examiner",
      archived: true,
    });

    const resetOne = service.resetProfile(exam, "mentor");
    expect(resetOne.profiles.find((profile) => profile.id === "mentor")?.name).toBe("Magister");
    expect(service.activeProfiles(exam).map((profile) => profile.id)).toEqual(["mentor", "custom"]);

    const resetAll = service.resetSettings(exam);
    expect(resetAll.profiles.map((profile) => profile.id)).toEqual(["mentor", "examiner"]);
  });
});

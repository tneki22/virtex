import { z } from "zod";

export const studyModeSchema = z.enum(["study", "exam"]);
export const sessionKindSchema = z.enum(["tutor", "review", "exam", "document"]);
export const sessionScopeTypeSchema = z.enum(["question", "document"]);
export const examQuestionCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
]);

export const runtimeAISettingsUpdateSchema = z.object({
  textProvider: z.enum(["openrouter", "groq"]),
  textModel: z.string().trim().min(1).max(200),
  textStreamingPreference: z.enum(["auto", "on", "off"]).default("auto"),
  speechProvider: z.enum(["openrouter", "groq", "disabled"]),
  speechModel: z.string().trim().max(200),
  embeddingModel: z.string().trim().min(1).max(200).optional(),
  openrouterApiKey: z.string().trim().min(1).max(1_000).optional(),
  groqApiKey: z.string().trim().min(1).max(1_000).optional(),
  clearOpenrouterApiKey: z.boolean().optional(),
  clearGroqApiKey: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.speechProvider !== "disabled" && value.speechModel.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["speechModel"],
      message: "Speech model is required",
    });
  }
  if (value.openrouterApiKey && value.clearOpenrouterApiKey) {
    context.addIssue({
      code: "custom",
      path: ["openrouterApiKey"],
      message: "Cannot replace and clear the OpenRouter key together",
    });
  }
  if (value.groqApiKey && value.clearGroqApiKey) {
    context.addIssue({
      code: "custom",
      path: ["groqApiKey"],
      message: "Cannot replace and clear the GroqCloud key together",
    });
  }
});

export const sourceReferenceSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
  fragmentId: z.string().min(1).optional(),
  quote: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

export const sourceFragmentSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  text: z.string().min(1),
});

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(["pdf", "markdown", "text"]),
  path: z.string().min(1),
  role: z.enum(["questions", "answers", "textbook", "lecture", "notes", "other"]).optional(),
  searchable: z.boolean().optional(),
  pageCount: z.number().int().positive().optional(),
  fragments: z.array(sourceFragmentSchema).optional(),
});

export const systemPromptSetSchema = z.object({
  studyTutor: z.string().trim().min(1).max(12_000),
  studyReview: z.string().trim().min(1).max(12_000),
  examFinal: z.string().trim().min(1).max(12_000),
  documentTutor: z
    .string()
    .trim()
    .min(1)
    .max(12_000)
    .default("Use the selected document as the authoritative study source."),
});

export const quickPromptSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(2_000),
});

export const examinerProfileSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  tone: z.enum(["supportive", "neutral", "strict"]),
  persona: z.enum(["magister", "fomin", "commission"]).optional(),
  systemPrompts: systemPromptSetSchema.optional(),
  quickPrompts: z.array(quickPromptSchema).optional(),
  archived: z.boolean().optional(),
});

export const editableExaminerProfileSchema = examinerProfileSchema.extend({
  systemPrompts: systemPromptSetSchema,
  quickPrompts: z.array(quickPromptSchema),
}).superRefine((profile, context) => {
  const quickPromptIds = new Set<string>();
  for (const prompt of profile.quickPrompts) {
    if (quickPromptIds.has(prompt.id)) {
      context.addIssue({
        code: "custom",
        path: ["quickPrompts"],
        message: `Duplicate quick prompt ID: ${prompt.id}`,
      });
    }
    quickPromptIds.add(prompt.id);
  }
});

export const runtimePromptSettingsUpdateSchema = z.object({
  profiles: z.array(editableExaminerProfileSchema).min(1),
}).superRefine((value, context) => {
  const activeProfiles = value.profiles.filter((profile) => !profile.archived);
  if (activeProfiles.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["profiles"],
      message: "At least one active profile is required",
    });
  }

  const profileIds = new Set<string>();
  for (const profile of value.profiles) {
    if (profileIds.has(profile.id)) {
      context.addIssue({
        code: "custom",
        path: ["profiles"],
        message: `Duplicate profile ID: ${profile.id}`,
      });
    }
    profileIds.add(profile.id);
  }
});

export const examQuestionSchema = z.object({
  id: z.string().min(1),
  officialNumber: z.number().int().positive(),
  officialText: z.string().min(1),
  displayText: z.string().min(1),
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  referenceAnswer: z.string().min(1),
  emphasis: z.array(z.string().min(1)),
  sources: z.array(sourceReferenceSchema).min(1),
  flags: z.array(z.string().min(1)).optional(),
});

export const examPackageSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  subject: z.string().min(1),
  profiles: z.array(examinerProfileSchema).min(1),
  documents: z.array(sourceDocumentSchema).min(1),
  questions: z.array(examQuestionSchema).min(1),
  thresholds: z.object({
    almostReady: z.number().int().min(0).max(100),
    ready: z.number().int().min(0).max(100),
  }),
  policy: z.object({
    timerMinutes: z.number().int().positive().nullable(),
    maxFollowUps: z.number().int().min(0).max(2),
    referenceReveal: z.literal("after_attempt_or_explicit"),
  }),
  styleGuide: z.string().min(1),
});

const aiCitationSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
  fragmentId: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
  note: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
});

export const aiReviewContentSchema = z.object({
  action: z.enum(["clarify", "final", "unavailable"]),
  examinerMessage: z.string().min(1),
  baseScore: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .transform((value) => value ?? undefined),
  personaVerdict: z.string().min(1),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  errors: z.array(z.string()),
  citations: z.array(aiCitationSchema),
  advice: z.string().min(1),
  challengeQuestions: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? undefined),
});

export const aiReviewSchema = aiReviewContentSchema.extend({
  model: z.string().optional(),
  packageVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
});

export type AIReviewInput = z.input<typeof aiReviewSchema>;

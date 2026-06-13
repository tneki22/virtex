import { z } from "zod";

export const studyModeSchema = z.enum(["study", "exam"]);
export const examQuestionCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
]);

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
  pageCount: z.number().int().positive().optional(),
  fragments: z.array(sourceFragmentSchema).optional(),
});

export const examinerProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tone: z.enum(["supportive", "neutral", "strict"]),
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
});

export const aiReviewSchema = aiReviewContentSchema.extend({
  model: z.string().optional(),
  packageVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
});

export type AIReviewInput = z.input<typeof aiReviewSchema>;

export type StudyMode = "study" | "practice" | "exam";

export type ReadinessStatus =
  | "not_started"
  | "review"
  | "almost_ready"
  | "ready";

export type AIAction = "clarify" | "final" | "unavailable";

export interface SourceReference {
  documentId: string;
  page: number;
  fragmentId?: string;
  quote?: string;
  note?: string;
}

export interface SourceFragment {
  id: string;
  page: number;
  text: string;
}

export interface SourceDocument {
  id: string;
  title: string;
  type: "pdf" | "markdown" | "text";
  path: string;
  pageCount?: number;
  fragments?: SourceFragment[];
}

export interface ExaminerProfile {
  id: string;
  name: string;
  description: string;
  tone: "supportive" | "neutral" | "strict";
}

export interface ExamQuestion {
  id: string;
  officialNumber: number;
  officialText: string;
  displayText: string;
  groupId: string;
  groupTitle: string;
  referenceAnswer: string;
  emphasis: string[];
  sources: SourceReference[];
  flags?: string[];
}

export interface ExamPolicy {
  timerMinutes: number | null;
  maxFollowUps: number;
  referenceReveal: "after_attempt_or_explicit";
}

export interface ReadinessThresholds {
  almostReady: number;
  ready: number;
}

export interface ExamPackage {
  id: string;
  version: string;
  title: string;
  description: string;
  subject: string;
  profiles: ExaminerProfile[];
  documents: SourceDocument[];
  questions: ExamQuestion[];
  thresholds: ReadinessThresholds;
  policy: ExamPolicy;
  styleGuide: string;
}

export interface StudySession {
  id: string;
  examId: string;
  questionId: string;
  mode: StudyMode;
  profileId: string;
  status: "active" | "completed";
  followUpCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface Attempt {
  id: string;
  sessionId: string;
  questionId: string;
  examId?: string;
  questionTitle?: string;
  answer: string;
  baseScore?: number;
  xp: number;
  createdAt: string;
}

export interface AIReview {
  action: AIAction;
  examinerMessage: string;
  baseScore?: number;
  personaVerdict: string;
  strengths: string[];
  gaps: string[];
  errors: string[];
  citations: SourceReference[];
  advice: string;
  model?: string;
  packageVersion: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface QuestionProgress {
  questionId: string;
  bestScore?: number;
  latestScore?: number;
  attempts: number;
  readiness: ReadinessStatus;
}

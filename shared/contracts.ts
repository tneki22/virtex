export type StudyMode = "study" | "exam";
export type SessionKind = "tutor" | "review" | "exam" | "document";
export type SessionScopeType = "question" | "document";
export type AIProviderId = "openrouter" | "groq";
export type SpeechProviderId = AIProviderId | "disabled";
export type KeySource = "application" | "environment" | "missing";
export type StreamingPreference = "auto" | "on" | "off";
export type DocumentRole = "questions" | "answers" | "textbook" | "lecture" | "notes" | "other";

export interface ExamMaterialFile {
  name: string;
  size: number;
  url: string;
}

export interface RuntimeAISettings {
  keys: Record<AIProviderId, { configured: boolean; source: KeySource }>;
  text: {
    provider: AIProviderId;
    model: string;
    available: boolean;
    streamingPreference: StreamingPreference;
    streamingAvailable: boolean;
  };
  embeddings: { provider: "openrouter"; model: string; available: boolean };
  speech: { provider: SpeechProviderId; model: string; available: boolean };
}

export interface RuntimeAISettingsUpdate {
  textProvider: AIProviderId;
  textModel: string;
  textStreamingPreference?: StreamingPreference;
  speechProvider: SpeechProviderId;
  speechModel: string;
  embeddingModel?: string;
  openrouterApiKey?: string;
  groqApiKey?: string;
  clearOpenrouterApiKey?: boolean;
  clearGroqApiKey?: boolean;
}

export interface AIConnectionTestResult {
  ok: boolean;
  provider: AIProviderId;
  model: string;
  message?: string;
}

export interface QuickPrompt {
  id: string;
  label: string;
  prompt: string;
}

export interface SystemPromptSet {
  studyTutor: string;
  studyReview: string;
  examFinal: string;
  documentTutor: string;
}

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

export interface RetrievedSourceReference extends SourceReference {
  score: number;
  text?: string;
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
  role?: DocumentRole;
  searchable?: boolean;
  pageCount?: number;
  fragments?: SourceFragment[];
}

export interface ExaminerProfile {
  id: string;
  name: string;
  description: string;
  tone: "supportive" | "neutral" | "strict";
  persona?: "magister" | "fomin" | "commission";
  systemPrompts?: SystemPromptSet;
  quickPrompts?: QuickPrompt[];
  archived?: boolean;
}

export interface EditableExaminerProfile {
  id: string;
  name: string;
  description: string;
  tone: "supportive" | "neutral" | "strict";
  persona?: "magister" | "fomin" | "commission";
  systemPrompts: SystemPromptSet;
  quickPrompts: QuickPrompt[];
  archived?: boolean;
}

export interface RuntimePromptSettings {
  examId: string;
  profiles: EditableExaminerProfile[];
  defaults: EditableExaminerProfile[];
  updatedAt?: string;
}

export interface RuntimePromptSettingsUpdate {
  profiles: EditableExaminerProfile[];
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
  scopeType?: SessionScopeType;
  questionId?: string;
  documentId?: string;
  mode: StudyMode;
  kind: SessionKind;
  title: string;
  profileId: string;
  status: "active" | "completed";
  followUpCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StudyChatSummary extends StudySession {
  messageCount: number;
  latestMessage?: string;
  latestReview?: AIReview;
}

export interface StudyChatDetail extends StudySession {
  messages: SessionMessage[];
  reviews: AIReview[];
}

export interface TutorTurnResponse {
  user: SessionMessage;
  assistant: SessionMessage;
  title: string;
  updatedAt: string;
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
  challengeQuestions?: string[];
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
  sources?: RetrievedSourceReference[];
}

export type DocumentIndexState = "missing" | "ready" | "stale" | "unavailable";

export interface DocumentIndexStatus {
  state: DocumentIndexState;
  indexedFragments?: number;
  embeddingModel?: string;
  updatedAt?: string;
  message?: string;
}

export interface DocumentStudyDocument extends Omit<SourceDocument, "fragments"> {
  searchable: true;
  indexStatus: DocumentIndexStatus;
}

export interface QuestionProgress {
  questionId: string;
  bestScore?: number;
  latestScore?: number;
  attempts: number;
  readiness: ReadinessStatus;
}

export type ExamQuestionCount = 1 | 2 | 3 | 5;

export interface ExamRunItem {
  id: string;
  questionId: string;
  position: number;
  status: "pending" | "active" | "completed";
  sessionId?: string;
  baseScore?: number;
  xp: number;
}

export interface ExamRun {
  id: string;
  examId: string;
  profileId: string;
  questionCount: ExamQuestionCount;
  currentPosition: number;
  status: "active" | "completed";
  items: ExamRunItem[];
  createdAt: string;
  completedAt?: string;
}

export interface ExamRunSummary {
  averageScore?: number;
  ready: number;
  almostReady: number;
  review: number;
  unscored: number;
  totalXp: number;
  results: ExamRunItem[];
}

export interface ExamRunStep {
  run: ExamRun;
  session?: StudySession;
  summary?: ExamRunSummary;
}

export interface ExamHistorySummary {
  runId: string;
  examId: string;
  examTitle: string;
  questionCount: number;
  averageScore?: number;
  totalXp: number;
  completedAt: string;
}

export interface ExamHistoryItem {
  position: number;
  questionId: string;
  questionTitle: string;
  officialText: string;
  answer: string;
  baseScore?: number;
  xp: number;
  review: AIReview;
}

export interface ExamHistoryDetail {
  summary: ExamHistorySummary;
  items: ExamHistoryItem[];
}

export interface StudyAttemptHistoryEntry extends Attempt {
  review: AIReview;
}

export interface HistoryData {
  examRuns: ExamHistorySummary[];
  studyAttempts: StudyAttemptHistoryEntry[];
}

export interface DocumentRagProfile {
  topK: number;
  neighborWindow: number;
  maxContextCharacters: number;
  promptSourceCharacters: number;
  maxCompletionTokens: number;
  maxEstimatedInputTokens: number;
}

export const DEFAULT_DOCUMENT_RAG_PROFILE = {
  topK: 10,
  neighborWindow: 2,
  maxContextCharacters: 16_000,
  promptSourceCharacters: 16_000,
  maxCompletionTokens: 6_000,
  maxEstimatedInputTokens: 14_000,
} as const satisfies DocumentRagProfile;

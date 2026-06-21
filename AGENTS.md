# AGENTS.md

## Project

Virtex is a local exam trainer for database exam preparation. The app has a React/Vite client, an Express API server, shared TypeScript contracts, a SQLite runtime store, and content compiled from `content/exams/database-fundamentals`.

## Commands

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run content:validate
npm run build
npm run test:e2e
npm run rag:check
```

Use `npm run dev` for local development. Use `npm run app` when a production build plus local server is needed.

## Architecture

- `client/src` contains the React UI, API adapters, and reusable controls.
- `server` contains Express routes, SQLite repositories, AI provider integration, prompt building, and runtime settings services.
- `shared` contains contracts, zod schemas, and cross-runtime helpers.
- `content/exams/database-fundamentals` is the source package for exam data.
- `runtime/virtex.sqlite` stores local runtime settings, history, attempts, notes, chats, and prompt overrides.

## Study Mode 2 / Document RAG

Study Mode 2 is the document-grounded chat at `/exams/:examId/document-study`. The React screen is `client/src/screens/DocumentStudy.tsx`; the HTTP adapter methods live in `client/src/api.ts`.

The RAG implementation is local-first:

- searchable documents are selected from compiled exam documents with `searchable: true`; `official-questions` is intentionally not searchable;
- `scripts/compiler.ts` extracts PDF text with `pdfjs-dist`, creates `SourceFragment` records per page, and splits long page text into chunks of up to 1,200 characters;
- `server/document-retrieval.ts` builds embeddings in batches of 32 through the configured OpenRouter embedding model, normalizes vectors, and stores them in SQLite tables `rag_documents` and `rag_embeddings`;
- index status is keyed by exam id, package version, document id, and embedding model; a content hash marks indexes as `stale` when compiled fragments change;
- retrieval embeds only the user query, scores stored vectors locally with a normalized dot product, uses `DEFAULT_DOCUMENT_RAG_PROFILE` (`topK: 10`, `neighborWindow: 2`, `maxContextCharacters: 16,000`) to expand matches into ordered neighbor blocks, and deduplicates repeated fragments;
- retrieved source metadata is stored with assistant messages in `message_sources`.

`buildDocumentTutorRequest` in `server/prompt.ts` is the only prompt builder for Study Mode 2. It sends document metadata plus the retrieved fragments as JSON in `Document context`; it does not send the whole document, the full compiled package, question reference answers, or unrelated pages. Current message text is clipped to 4,000 characters; retained dialogue is clipped to 4,000 characters total and 1,000 per message. Document tutor completions use `max_completion_tokens: 6_000`; ordinary tutor chat remains at `1_200`. The document tutor prompt explicitly tells the model not to artificially compress answers when retrieved context is rich.

Approximate Study Mode 2 token budget uses the project estimator `ceil(JSON.stringify(messages).length / 3.5)`: a rich document-chat request with expanded retrieval context is expected to land around 5.5k-8k input tokens plus up to 6k output tokens, with a `maxEstimatedInputTokens` guardrail of 14k for document tutor prompts. The initial embedding index is separate from chat requests and is roughly 21k embedding input tokens for `detailed-answers` and 110k for `textbook` in the current compiled package.

## Prompt Safety

User-editable prompt settings are a persona layer only. Do not move core safety rules into editable client data.

Immutable prompt rules stay server-side in `server/prompt.ts`, including:

- prompt injection resistance;
- reference-answer privacy before review;
- JSON review format requirements;
- citation rules;
- exam/study mode boundaries.

Runtime prompt settings are stored per exam in the SQLite `settings` table under keys like `prompts.<examId>`. Archived profiles must remain resolvable for existing sessions, but must not appear in new profile pickers.

## Testing Notes

When changing shared contracts or prompt behavior, run at least:

```powershell
npm run typecheck
npm test
npm run content:validate
npm run build
```

When changing Study Mode 2, document retrieval, compiled document fragments, or embedding settings, also run:

```powershell
npm run rag:check
```

Add focused tests near the changed layer:

- shared schema changes: `tests/shared`;
- server prompt/API changes: `tests/server`;
- React UI/API adapter changes: `tests/client`;
- browser flows: Playwright tests under `tests/e2e` when the behavior crosses routing or real browser constraints.

## Working Rules

Prefer existing components, styles, and contracts before adding new abstractions. Keep prompt edits explicit and testable. Avoid changing compiled content or runtime database files unless the task specifically requires it.

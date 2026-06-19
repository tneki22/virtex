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
```

Use `npm run dev` for local development. Use `npm run app` when a production build plus local server is needed.

## Architecture

- `client/src` contains the React UI, API adapters, and reusable controls.
- `server` contains Express routes, SQLite repositories, AI provider integration, prompt building, and runtime settings services.
- `shared` contains contracts, zod schemas, and cross-runtime helpers.
- `content/exams/database-fundamentals` is the source package for exam data.
- `runtime/virtex.sqlite` stores local runtime settings, history, attempts, notes, chats, and prompt overrides.

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

Add focused tests near the changed layer:

- shared schema changes: `tests/shared`;
- server prompt/API changes: `tests/server`;
- React UI/API adapter changes: `tests/client`;
- browser flows: Playwright tests under `tests/e2e` when the behavior crosses routing or real browser constraints.

## Working Rules

Prefer existing components, styles, and contracts before adding new abstractions. Keep prompt edits explicit and testable. Avoid changing compiled content or runtime database files unless the task specifically requires it.

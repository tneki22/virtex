# Editable Prompt Settings

## Overview

Prompt settings let a user edit examiner personalities per exam package. The editable layer controls profile names, descriptions, tone, quick prompts, and persona instructions for study tutor, study review, and final exam review modes.

The full system prompt is not editable. Core guardrails remain server-side.

## Data Model

`EditableExaminerProfile` extends the public examiner profile with:

- `systemPrompts.studyTutor`
- `systemPrompts.studyReview`
- `systemPrompts.examFinal`
- `quickPrompts`
- optional `archived`

Validation limits:

- profile name: 1 to 80 characters;
- profile description: 1 to 600 characters;
- each system prompt: 1 to 12,000 characters;
- quick prompt label: 1 to 80 characters;
- quick prompt body: 1 to 2,000 characters;
- profile IDs and quick prompt IDs must be unique in their own scope;
- at least one active profile must remain.

## Storage

`RuntimePromptService` stores settings in the SQLite `settings` table as JSON under:

```text
prompts.<examId>
```

Defaults are derived from `ExamPackage.profiles` and the legacy persona instructions. Stored profiles override defaults by `id`; custom profiles are appended after package defaults.

## API

`GET /api/exams/:id`

Returns the exam with active resolved profiles only. These profiles include current names, descriptions, tone, and quick prompts for new chats and exam runs.

`GET /api/exams/:id/prompts`

Returns editable prompt settings and defaults. The editable set may include archived profiles so soft deletes survive later saves.

`PUT /api/exams/:id/prompts`

Saves the full validated editable profile set. The server validates shape, limits, duplicate IDs, and the active-profile requirement.

## Runtime Flow

1. The overview page loads normal exam data with `GET /api/exams/:id`.
2. `PromptSettingsEditor` loads editable prompt settings with `GET /api/exams/:id/prompts`.
3. The user edits profiles, system prompts, and quick prompts locally.
4. Save sends the full profile set to `PUT /api/exams/:id/prompts`.
5. New study chats and exam runs use active profiles from `GET /api/exams/:id`.
6. Existing sessions resolve their saved `profileId` through `RuntimePromptService.resolveProfile`, including archived profiles.

## Reset And Delete

Deleting a profile marks it as `archived`; it is hidden from new pickers but remains resolvable for old sessions.

Built-in profiles can be reset by replacing the edited profile with its default profile from the `defaults` payload and saving. Resetting all profiles is supported by the runtime service by deleting the stored `prompts.<examId>` row.

## Prompt Construction

`server/prompt.ts` maps prompt modes to editable fields:

- `study_tutor` -> `studyTutor`
- `study_review` -> `studyReview`
- `exam_final` -> `examFinal`

If a profile has no custom prompt for a mode, the builder falls back to the default persona instructions. Immutable guardrails are prepended/appended server-side and are not editable from the client.

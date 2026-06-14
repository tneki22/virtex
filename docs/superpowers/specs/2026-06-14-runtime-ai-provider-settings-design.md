# Runtime AI Provider Settings Design

**Date:** 2026-06-14

## Goal

Allow a local user to configure API keys, providers, and models from the exam overview page and apply the selection immediately to tutor dialogue, answer review, and speech transcription without restarting the server.

## Scope

- Text tasks use one selected provider and model for both tutor dialogue and answer review.
- Speech transcription independently uses a selected provider and model.
- Supported providers are OpenRouter and GroqCloud.
- Speech transcription may be disabled.
- Existing environment variables remain valid fallbacks and do not need to be re-entered.
- The standalone `/settings` route and `Settings.tsx` screen are removed.

## User Interface

The exam overview renders an `AI providers` section below the study and exam mode cards.

The section contains:

- OpenRouter status, API key password field, and key source (`environment`, `application`, or `missing`).
- GroqCloud status, API key password field, and key source.
- Text provider selector: OpenRouter or GroqCloud.
- Text model field. The value is free-form for both providers so newly released model IDs do not require an application update.
- Speech provider selector: OpenRouter, GroqCloud, or disabled.
- Speech model field, independent from the text model.
- A summary of the currently active text and speech provider/model pairs.
- Save button.
- Separate connection tests for text and speech.

Password fields never display a stored value or key prefix. Leaving a key field empty preserves the current application key or environment fallback. An explicit `Use environment key` action deletes only the application override. The status refreshes after every save or connection test.

## Configuration And Precedence

Runtime settings are stored in the existing SQLite `settings` table. API keys are stored as plain text because this is a local, single-user application. This protects keys from browser exposure, but it is not encryption at rest: any process or operating-system user that can read the SQLite file can read the keys.

For each key, precedence is:

1. Non-empty application override in SQLite.
2. Non-empty environment value loaded from the process, `.env`, or `.env.local`.
3. Missing.

Provider and model selections use the SQLite value when present and otherwise use environment-derived defaults:

- OpenRouter text key: `OPENAI_API_KEY`; base URL: `OPENAI_BASE_URL` or `https://openrouter.ai/api/v1`; model: `OPENAI_MODEL` or `openai/gpt-5-mini`.
- GroqCloud key: `GROQ_API_KEY`; base URL: `GROQ_BASE_URL` or `https://api.groq.com/openai/v1`.
- GroqCloud speech model: `GROQ_WHISPER_MODEL` or `whisper-large-v3-turbo`.

The application stores explicit task selections rather than inferring them from which keys exist. A key can therefore serve text, speech, both, or neither.

## Server Architecture

A runtime AI settings service owns immutable environment fallbacks, SQLite overrides, and provider construction. It exposes:

- a sanitized status snapshot;
- an atomic settings update;
- the current text provider;
- the current speech provider;
- provider-specific connection tests.

Saving settings validates the complete candidate configuration first. If valid, the service writes all changed values in one SQLite transaction and replaces the in-memory provider snapshot. Requests already in progress retain their provider instance; subsequent requests use the new snapshot.

`createApp` receives the runtime service instead of fixed `aiProvider` and `speechProvider` instances. Tutor dialogue and review resolve the text provider at request time. Transcription resolves the speech provider at request time. This prevents startup environment defaults from silently overriding an in-app selection.

## Provider Adapters

Text requests for both providers use the OpenAI-compatible chat completions API. Each provider instance carries its provider ID, base URL, key, and selected model. Review records continue to persist the actual configured model.

Speech adapters share the existing `SpeechTranscriptionProvider` contract but use provider-specific payloads:

- GroqCloud uses the OpenAI-compatible multipart `/audio/transcriptions` endpoint.
- OpenRouter uses `/api/v1/audio/transcriptions` with base64 `input_audio`, the selected STT model, and optional Russian language hint.

Each transcription response reports the configured provider and model. Audio remains in memory and is not persisted.

## API Contracts

`GET /api/settings/ai` returns only sanitized state:

- key presence and source for each provider;
- selected text provider and model;
- selected speech provider and model;
- effective active configuration and availability.

`PUT /api/settings/ai` accepts provider/model selections, optional replacement keys, and explicit flags to clear application key overrides. It never echoes submitted keys.

`POST /api/settings/ai/test-text` tests the currently saved text selection and returns provider, requested model, success, and a safe error message.

`POST /api/settings/ai/test-speech` accepts a small uploaded audio sample, tests the currently saved speech selection, and returns provider, requested model, transcribed text, and success. When speech is disabled it returns a configuration error without contacting a provider.

The existing `/api/settings/status` and `/api/settings/ai/test` endpoints are replaced by these contracts.

## Error Handling

- A provider cannot be selected for a task unless its effective key exists.
- Provider and model IDs are trimmed, length-bounded strings.
- Failed validation does not modify SQLite or the active provider snapshot.
- Failed connection tests do not roll back saved settings; they report that the saved selection is currently unusable.
- Provider errors are mapped to safe messages and never include authorization headers, submitted keys, or stored key fragments.
- If no text provider is configured, tutor and review endpoints retain their current `503` behavior.
- If speech is disabled or unavailable, transcription returns `503` and leaves the answer draft unchanged.

## Verification

Server tests prove that:

- SQLite key overrides take precedence over environment keys.
- Clearing an override returns to the environment key.
- API responses never expose key values or prefixes.
- Saving a new text provider/model changes the next tutor and review calls without restart.
- Saving a new speech provider/model changes the next transcription call without restart.
- GroqCloud can serve text and speech simultaneously with separate models.
- OpenRouter can serve text and speech simultaneously with separate models.
- The exact selected model is present in outgoing provider requests.
- Review persistence records the model used for the request.

Client tests prove that:

- the overview displays both key statuses and the active task configuration;
- free-form model fields save correctly;
- empty password fields preserve existing keys;
- explicit environment fallback clears only the application override;
- save and connection-test results refresh the displayed effective state;
- the removed `/settings` route redirects to the overview.

The final verification includes type checking, focused tests, the full Vitest suite, production build, and E2E coverage of changing providers and observing the active model status.

## Security Boundaries

- Keys are submitted only to the local Express server and are never stored in browser storage.
- Status endpoints reveal only presence and source, never key material.
- SQLite key storage is acceptable for the stated local single-user deployment but is not suitable for a shared or remotely exposed server without encrypted secret storage and authentication.
- The server continues binding to `127.0.0.1` by default.

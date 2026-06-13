# Study Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Упростить приложение до режимов «Изучение» и «Экзамен», сделать рабочие панели регулируемыми, исправить эталоны, добавить экзамены на 1/2/3/5 вопросов и голосовой ввод через Groq Whisper.

**Architecture:** Существующая модель одной `StudySession` сохраняется для проверки отдельного вопроса. Последовательный экзамен добавляет агрегат `ExamRun`, который хранит уникальные вопросы и связывает каждый из них с отдельной сессией; итог рассчитывается кодом без AI. Клиентский workspace получает отдельные компоненты для панелей, прогрессивного текста и записи голоса, а серверный Groq-адаптер работает только с аудио и не раскрывает ключ браузеру.

**Tech Stack:** React 19, React Router, TypeScript, Express 5, SQLite/better-sqlite3, Zod, OpenAI Node SDK с Groq-compatible endpoint, Multer memory storage, Vitest, Testing Library, Supertest, Playwright.

---

## File Map

- Modify `content/exams/database-fundamentals/questions.json` - исправленные эталоны и ссылки на основной PDF.
- Modify `scripts/bootstrap-database-exam.ts` - воспроизводимые правила повторов и составного вопроса.
- Modify `tests/content/database-package.test.ts` - происхождение всех 48 эталонов.
- Modify `shared/contracts.ts` and `shared/schemas.ts` - два режима, `ExamRun`, summary и speech contracts.
- Create `shared/exam-run.ts` - выбор уникальных вопросов и расчёт итогов.
- Modify `server/database.ts` - таблицы и миграция `ExamRun`.
- Create `server/exam-runs.ts` - SQL-репозиторий запуска экзамена.
- Create `server/transcription.ts` - Groq-compatible speech provider.
- Modify `server/config.ts`, `server/index.ts`, `server/app.ts` - конфигурация, API запусков и endpoint транскрипции.
- Modify `client/src/App.tsx`, `client/src/screens/ExamOverview.tsx` - прямой старт и два режима.
- Create `client/src/hooks/usePanelLayout.ts` and `client/src/components/PanelResizeHandle.tsx` - регулируемые панели.
- Create `client/src/components/ProgressiveText.tsx` - динамическое раскрытие без новых AI-вызовов.
- Create `client/src/hooks/useVoiceInput.ts` - `MediaRecorder` и загрузка аудио.
- Create `client/src/components/ExamRunSummary.tsx` - сводка серии вопросов.
- Modify `client/src/screens/Workspace.tsx`, `client/src/api.ts`, `client/src/styles.css` - новый UX и клиентский поток.
- Modify `tests/server/api.test.ts`, `tests/client/workspace.test.tsx`, `tests/e2e/workflows.spec.ts` - контрактные, компонентные и E2E-проверки.
- Modify `README.md`, `.env.example` - запуск и Groq-конфигурация.

### Task 1: Make `detailed_answers.pdf` the authoritative answer source

**Files:**
- Modify: `scripts/bootstrap-database-exam.ts`
- Modify: `content/exams/database-fundamentals/questions.json`
- Modify: `tests/content/database-package.test.ts`
- Generated: `content/exams/database-fundamentals/compiled/package.json`

- [ ] **Step 1: Write failing content tests**

Add assertions that every question points to `detailed-answers`, aliases use the expected pages, and removed unsupported phrases cannot return:

```ts
const byNumber = new Map(exam.questions.map((question) => [question.officialNumber, question]));

expect(byNumber.get(19)?.sources[0]).toMatchObject({ documentId: "detailed-answers", page: 5 });
expect(byNumber.get(28)?.sources[0]).toMatchObject({ documentId: "detailed-answers", page: 23 });
expect(byNumber.get(36)?.sources[0]).toMatchObject({ documentId: "detailed-answers", page: 14 });
expect(byNumber.get(40)?.sources[0]).toMatchObject({ documentId: "detailed-answers", page: 25 });
expect(byNumber.get(45)?.sources[0]).toMatchObject({ documentId: "detailed-answers", page: 30 });

for (const question of exam.questions) {
  expect(question.sources[0]?.documentId).toBe("detailed-answers");
}

const unsupported = /WAL Buffer|synchronous_commit|TRUNCATE|Schema-on-Write|Schema-on-Read/u;
for (const number of [19, 28, 36, 40, 45]) {
  expect(byNumber.get(number)?.referenceAnswer).not.toMatch(unsupported);
}
```

- [ ] **Step 2: Run the content test and verify RED**

Run: `npm test -- tests/content/database-package.test.ts`

Expected: FAIL because questions 19, 28, 36, 40 and 45 still reference `textbook` and contain manual text.

- [ ] **Step 3: Add deterministic alias rules to the bootstrap script**

Use aliases after extracting `detailedAnswers`:

```ts
const answerAliases = new Map<number, number>([
  [19, 4],
  [28, 23],
  [36, 13],
  [45, 31],
]);

function answerForQuestion(number: number): { page: number; answer: string } | undefined {
  if (number === 40) {
    const compound = detailedAnswers.get(25);
    if (!compound) return undefined;
    const boundary = compound.answer.indexOf("Нереляционные базы данных");
    return {
      page: compound.page,
      answer: compound.answer.slice(0, boundary === -1 ? undefined : boundary).trim(),
    };
  }
  return detailedAnswers.get(answerAliases.get(number) ?? number);
}
```

Replace manual source selection with the resolved detailed answer and retain flags only as metadata:

```ts
const detailed = answerForQuestion(number);
if (!detailed) throw new Error(`No detailed answer for question ${number}`);

referenceAnswer: detailed.answer,
sources: [{
  documentId: "detailed-answers",
  page: detailed.page,
  note: `Эталон для вопроса ${number}`,
}],
```

- [ ] **Step 4: Regenerate and verify content**

Run:

```powershell
npm run content:bootstrap
npm run content:build
npm test -- tests/content/database-package.test.ts
```

Expected: package contains 48 questions, all content tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/bootstrap-database-exam.ts content/exams/database-fundamentals/questions.json content/exams/database-fundamentals/compiled/package.json tests/content/database-package.test.ts
git commit -m "fix: source all exam answers from detailed answers"
```

### Task 2: Reduce study modes to `study` and `exam`

**Files:**
- Modify: `shared/contracts.ts`
- Modify: `shared/schemas.ts`
- Create: `shared/study-mode.ts`
- Test: `tests/shared/contracts.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write failing normalization tests**

```ts
import { normalizeStudyMode } from "../../shared/study-mode.js";

it("normalizes legacy practice links to exam", () => {
  expect(normalizeStudyMode("practice")).toBe("exam");
  expect(normalizeStudyMode("exam")).toBe("exam");
  expect(normalizeStudyMode("study")).toBe("study");
});

it("uses study for missing or invalid values", () => {
  expect(normalizeStudyMode(null)).toBe("study");
  expect(normalizeStudyMode("unknown")).toBe("study");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/shared/contracts.test.ts`

Expected: FAIL because `normalizeStudyMode` does not exist.

- [ ] **Step 3: Implement the two-mode contract**

```ts
// shared/study-mode.ts
import type { StudyMode } from "./contracts.js";

export function normalizeStudyMode(value: string | null | undefined): StudyMode {
  if (value === "exam" || value === "practice") return "exam";
  return "study";
}
```

Change the public type:

```ts
export type StudyMode = "study" | "exam";
```

Expose one shared Zod schema:

```ts
export const studyModeSchema = z.enum(["study", "exam"]);
```

Server request validation for new sessions becomes:

```ts
mode: studyModeSchema,
```

Keep `SessionRow.mode` as `string` and normalize it in `sessionFromRow` so old SQLite rows remain readable.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/shared/contracts.test.ts tests/server/api.test.ts`

Expected: PASS after updating legacy test fixtures from `practice` to `exam` where they create new sessions.

- [ ] **Step 5: Commit**

```powershell
git add shared/contracts.ts shared/schemas.ts shared/study-mode.ts server/app.ts tests/shared/contracts.test.ts tests/server/api.test.ts
git commit -m "refactor: keep study and exam modes only"
```

### Task 3: Open the database exam directly and show only two choices

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/AppShell.tsx`
- Modify: `client/src/screens/ExamOverview.tsx`
- Modify: `client/src/styles.css`
- Create: `tests/client/exam-overview.test.tsx`
- Modify: `tests/e2e/workflows.spec.ts`

- [ ] **Step 1: Write failing overview tests**

Render `ExamOverview` at `/` and assert:

```tsx
expect(await screen.findByRole("link", { name: /изучение/i })).toBeInTheDocument();
expect(screen.getByRole("link", { name: /экзамен/i })).toBeInTheDocument();
expect(screen.queryByText(/практика/i)).not.toBeInTheDocument();
expect(screen.queryByText(exam.description)).not.toBeInTheDocument();
expect(screen.queryByText(/источники/i)).not.toBeInTheDocument();
```

Verify the exam count control exposes exactly `1`, `2`, `3`, `5`, with `1` selected.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/client/exam-overview.test.tsx`

Expected: FAIL because the current overview has three modes and hero/statistics blocks.

- [ ] **Step 3: Replace root routing and simplify overview**

Use a fixed current package route while preserving `/exams/:examId`:

```tsx
<Route path="/" element={<Navigate to="/exams/database-fundamentals" replace />} />
<Route path="/exams/:examId" element={<ExamOverview />} />
```

Keep only a compact `mode-grid mode-grid-two`. The exam card owns local state:

```tsx
const [questionCount, setQuestionCount] = useState<ExamQuestionCount>(1);
const allowedCounts: ExamQuestionCount[] = [1, 2, 3, 5];
```

The study card links to the first question. The exam card navigates to `/workspace/random?mode=exam&count=<value>` without creating a run; profile selection and run creation happen in the central workspace.

- [ ] **Step 4: Update navigation wording**

Change the home nav label and brand aria-label from «Экзамены»/«список экзаменов» to «Подготовка». Keep History and Settings unchanged.

- [ ] **Step 5: Verify component and route tests**

Run: `npm test -- tests/client/exam-overview.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add client/src/App.tsx client/src/components/AppShell.tsx client/src/screens/ExamOverview.tsx client/src/styles.css tests/client/exam-overview.test.tsx
git commit -m "feat: simplify exam entry screen"
```

### Task 4: Add tested desktop panel sizing

**Files:**
- Create: `client/src/hooks/usePanelLayout.ts`
- Create: `client/src/components/PanelResizeHandle.tsx`
- Create: `tests/client/panel-layout.test.tsx`
- Modify: `client/src/screens/Workspace.tsx`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Write failing layout tests**

Test pure exported helpers before DOM behavior:

```ts
expect(clampPanelLayout({ left: 100, right: 900 }, 1440)).toEqual({ left: 220, right: 648 });
expect(clampPanelLayout({ left: 300, right: 360 }, 1440)).toEqual({ left: 300, right: 360 });
expect(parseStoredPanelLayout('{"left":320,"right":420}', 1440)).toEqual({ left: 320, right: 420 });
expect(parseStoredPanelLayout('broken', 1440)).toEqual(DEFAULT_PANEL_LAYOUT);
```

Render `PanelResizeHandle` and assert role, orientation, min/max/current ARIA values and arrow-key callback.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/client/panel-layout.test.tsx`

Expected: FAIL because hook and component do not exist.

- [ ] **Step 3: Implement constraints and persistence**

```ts
export const DEFAULT_PANEL_LAYOUT = { left: 280, right: 360 };
export const MIN_LEFT = 220;
export const MIN_CENTER = 480;
export const MIN_RIGHT = 300;

export function clampPanelLayout(layout: PanelLayout, width: number): PanelLayout {
  const maxSide = Math.floor(width * 0.45);
  const left = Math.min(maxSide, Math.max(MIN_LEFT, layout.left));
  const rightLimit = Math.max(MIN_RIGHT, width - left - MIN_CENTER - 12);
  const right = Math.min(maxSide, rightLimit, Math.max(MIN_RIGHT, layout.right));
  return { left, right };
}
```

The hook reads `virtex:panel-layout`, handles `pointermove`, saves valid values, and resets on double click.

- [ ] **Step 4: Implement accessible separators**

```tsx
<div
  role="separator"
  tabIndex={0}
  aria-orientation="vertical"
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  onPointerDown={onPointerDown}
  onDoubleClick={onReset}
  onKeyDown={handleArrowKeys}
/>
```

Use 12 px hit areas and a 1 px visible rule. Apply grid columns through CSS variables:

```tsx
style={{ "--left-panel": `${layout.left}px`, "--right-panel": `${layout.right}px` } as CSSProperties}
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/client/panel-layout.test.tsx tests/client/workspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add client/src/hooks/usePanelLayout.ts client/src/components/PanelResizeHandle.tsx client/src/screens/Workspace.tsx client/src/styles.css tests/client/panel-layout.test.tsx
git commit -m "feat: add resizable study panels"
```

### Task 5: Simplify the workspace and improve dialogue readability

**Files:**
- Create: `client/src/components/ProgressiveText.tsx`
- Create: `client/src/components/ExaminerProfilePicker.tsx`
- Modify: `client/src/screens/Workspace.tsx`
- Modify: `client/src/styles.css`
- Modify: `tests/client/workspace.test.tsx`

- [ ] **Step 1: Write failing workspace tests**

Assert these behaviors:

```tsx
expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Ответы", "Заметки"]);
expect(screen.queryByRole("tab", { name: /источники/i })).not.toBeInTheDocument();
expect(screen.getByRole("main")).toContainElement(screen.getByLabelText(/профиль экзаменатора/i));
```

In study mode, the reference text is visible immediately. In exam mode, «Ответы» is disabled until final review. After clarification, the submitted user answer and examiner message each occur once in the dialogue.

- [ ] **Step 2: Write failing progressive text tests**

Use fake timers:

```tsx
render(<ProgressiveText text="Первый фрагмент. Второй фрагмент." durationMs={400} />);
expect(screen.queryByText(/Второй фрагмент/)).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: /показать сразу/i }));
expect(screen.getByText(/Второй фрагмент/)).toBeInTheDocument();
```

Mock `matchMedia('(prefers-reduced-motion: reduce)')` and assert immediate rendering.

- [ ] **Step 3: Verify RED**

Run: `npm test -- tests/client/workspace.test.tsx`

Expected: FAIL because sources tab/profile position/current dialogue differ.

- [ ] **Step 4: Implement two right tabs and profile placement**

Change `RightTab` to `"answers" | "notes"`. Remove source fetch state/effect and citation-opening behavior from UI. Render `ExaminerProfilePicker` above the editor; disable it when `session !== null`.

Use paragraphs instead of one raw block:

```tsx
{question.referenceAnswer
  .split(/\n{2,}|(?<=\.)\s+(?=\d+\.)/u)
  .filter(Boolean)
  .map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
```

- [ ] **Step 5: Implement dialogue blocks and progressive AI text**

Store complete turns:

```ts
type DialogueTurn = { id: string; role: "student" | "examiner"; text: string };
```

Append the submitted answer before the request. On success append one examiner turn. On failure retain the editor answer and remove only the optimistic turn if it would duplicate editable text.

Render AI text through `ProgressiveText`; no network streaming and no additional model calls.

- [ ] **Step 6: Apply restrained typography**

Set dialogue copy to 17 px/1.65, reference answer to 17 px/1.72, cap readable text at 72 characters, and preserve the existing paper/navy/accent palette. Do not add gradients, decorative backgrounds or new navigation blocks.

- [ ] **Step 7: Verify GREEN**

Run: `npm test -- tests/client/workspace.test.tsx`

Expected: all workspace and progressive text cases PASS.

- [ ] **Step 8: Commit**

```powershell
git add client/src/components/ProgressiveText.tsx client/src/components/ExaminerProfilePicker.tsx client/src/screens/Workspace.tsx client/src/styles.css tests/client/workspace.test.tsx
git commit -m "feat: simplify workspace dialogue and answers"
```

### Task 6: Add the `ExamRun` domain model and database schema

**Files:**
- Modify: `shared/contracts.ts`
- Modify: `shared/schemas.ts`
- Create: `shared/exam-run.ts`
- Modify: `server/database.ts`
- Create: `server/exam-runs.ts`
- Create: `tests/shared/exam-run.test.ts`
- Create: `tests/server/exam-runs.test.ts`

- [ ] **Step 1: Write failing domain tests**

```ts
expect(selectQuestionIds(["q1", "q2", "q3", "q4"], 3, () => 0)).toEqual(["q1", "q2", "q3"]);
expect(() => selectQuestionIds(["q1"], 2, () => 0)).toThrow(/not enough questions/i);
expect(() => assertExamQuestionCount(4)).toThrow(/1, 2, 3, or 5/i);
```

Test summary calculation from scores `84`, `70`, `40` gives average `65`, ready `1`, almostReady `1`, review `1`, and sums XP.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/shared/exam-run.test.ts`

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Define contracts**

```ts
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

export interface ExamRunStep {
  run: ExamRun;
  session?: StudySession;
  summary?: ExamRunSummary;
}
```

Add `ExamRunSummary` with `averageScore`, readiness counts, `totalXp`, and per-question results.

Implement the exact validation and selection behavior:

```ts
const ALLOWED_COUNTS = [1, 2, 3, 5] as const;

export function assertExamQuestionCount(value: number): ExamQuestionCount {
  if (!ALLOWED_COUNTS.includes(value as ExamQuestionCount)) {
    throw new Error("Question count must be 1, 2, 3, or 5");
  }
  return value as ExamQuestionCount;
}

export function selectQuestionIds(
  ids: string[],
  count: ExamQuestionCount,
  random: () => number = Math.random,
): string[] {
  if (ids.length < count) throw new Error("Not enough questions");
  const pool = [...ids];
  return Array.from({ length: count }, () => {
    const index = Math.floor(random() * pool.length);
    return pool.splice(index, 1)[0];
  });
}
```

`calculateExamRunSummary(items, thresholds)` uses `Math.round(sum / scoredCount)` and `readinessFromScore`; an unavailable score is excluded from the average but remains in the per-question list.

- [ ] **Step 4: Add idempotent SQLite migration**

Create tables:

```sql
CREATE TABLE IF NOT EXISTS exam_runs (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count IN (1, 2, 3, 5)),
  current_position INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS exam_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES exam_runs(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  session_id TEXT REFERENCES sessions(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed')),
  UNIQUE(run_id, position),
  UNIQUE(run_id, question_id)
);
```

Use `PRAGMA table_info(sessions)` and `ALTER TABLE` to add nullable `exam_run_id` and `exam_run_position` only when absent.

- [ ] **Step 5: Implement repository operations**

`createExamRun`, `getExamRun`, `activateNextRunItem`, and `completeRunItem` execute transactions. `activateNextRunItem` returns the existing session if already active, making retries idempotent.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- tests/shared/exam-run.test.ts tests/server/exam-runs.test.ts`

Expected: PASS, including a migration test that calls `createDatabase` twice.

- [ ] **Step 7: Commit**

```powershell
git add shared/contracts.ts shared/schemas.ts shared/exam-run.ts server/database.ts server/exam-runs.ts tests/shared/exam-run.test.ts tests/server/exam-runs.test.ts
git commit -m "feat: add multi-question exam runs"
```

### Task 7: Expose sequential exam run APIs

**Files:**
- Modify: `server/app.ts`
- Modify: `client/src/api.ts`
- Modify: `tests/server/api.test.ts`

- [ ] **Step 1: Write failing API contract tests**

Create an exam fixture with at least six questions and deterministic `random`. Test:

```ts
const created = await request(app).post("/api/exam-runs").send({
  examId: "exam",
  profileId: "neutral",
  questionCount: 3,
});
expect(created.status).toBe(201);
expect(new Set(created.body.run.items.map((item: { questionId: string }) => item.questionId)).size).toBe(3);
expect(created.body.session.mode).toBe("exam");
```

Then submit a final review, call `POST /api/exam-runs/:id/next`, assert position `2`, and repeat until `summary` is returned. Also assert `questionCount: 4` returns 400 and an early `next` returns 409.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/server/api.test.ts`

Expected: 404 for `/api/exam-runs`.

- [ ] **Step 3: Implement endpoints**

Add:

```text
POST /api/exam-runs
GET  /api/exam-runs/:id
POST /api/exam-runs/:id/next
```

Creation validates the profile/count, selects unique IDs with the injected `random`, creates the first session, and returns `{ run, session }`.

When `persistReview` completes a session linked to a run, call `completeRunItem` in the same database transaction or immediately after the successful attempt/review transaction.

`next` returns either `{ run, session }` or `{ run, summary }`; it never calls AI.

- [ ] **Step 4: Extend the client API**

```ts
createExamRun(input: { examId: string; profileId: string; questionCount: ExamQuestionCount }): Promise<ExamRunStep>;
getExamRun(runId: string): Promise<ExamRunStep>;
advanceExamRun(runId: string): Promise<ExamRunStep>;
```

Update `MockExamApi` with deterministic unique question selection and in-memory run state for E2E.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/server/api.test.ts tests/shared/exam-run.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/app.ts client/src/api.ts tests/server/api.test.ts
git commit -m "feat: expose sequential exam run API"
```

### Task 8: Implement the multi-question exam client flow

**Files:**
- Create: `client/src/components/ExamRunSummary.tsx`
- Modify: `client/src/screens/ExamOverview.tsx`
- Modify: `client/src/screens/Workspace.tsx`
- Modify: `client/src/styles.css`
- Modify: `tests/client/exam-overview.test.tsx`
- Modify: `tests/client/workspace.test.tsx`

- [ ] **Step 1: Write failing client-flow tests**

From the overview, select `3`, click «Открыть экзамен», and assert navigation contains `mode=exam&count=3` while `createExamRun` has not been called. In Workspace select the profile, click «Начать экзамен», and assert `createExamRun` receives `questionCount: 3` and that profile.

For Workspace, provide `run=run-1` in the query string. After final review assert a button «Следующий вопрос 2 из 3». After the third final review assert summary values and no answer editor.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/client/exam-overview.test.tsx tests/client/workspace.test.tsx`

Expected: FAIL because run navigation and summary do not exist.

- [ ] **Step 3: Pass the selected count from the overview**

On exam button click:

```ts
navigate(`/exams/${exam.id}/workspace/random?mode=exam&count=${questionCount}`);
```

Do not place profile selection in the exam card.

- [ ] **Step 4: Create the run from the central workspace**

For `questionId=random`, show a compact central setup with `ExaminerProfilePicker` and «Начать экзамен». Validate `count` with `assertExamQuestionCount`; invalid URL values fall back to `1`. On click:

```ts
const step = await api.createExamRun({ examId, profileId, questionCount });
navigate(`/exams/${examId}/workspace/${step.session.questionId}?mode=exam&run=${step.run.id}`, { replace: true });
```

After creation the profile remains visible in the same central location and is disabled for the full run.

- [ ] **Step 5: Restore and advance runs in Workspace**

If query `run` exists, call `getExamRun` on mount. Use server state as authority for current question and session. The «Следующий вопрос» button calls `advanceExamRun` and navigates with `replace` to the returned question.

Clear dialogue, review and local answer only after a successful advance. Draft keys include run ID and question ID.

- [ ] **Step 6: Render the summary without AI**

`ExamRunSummary` shows average score, readiness counts, total XP and one row per question with its score. Provide «Новый экзамен» linking to the compact overview and «Изучить ошибки» linking to the lowest-scored question in study mode.

- [ ] **Step 7: Verify GREEN**

Run: `npm test -- tests/client/exam-overview.test.tsx tests/client/workspace.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add client/src/components/ExamRunSummary.tsx client/src/screens/ExamOverview.tsx client/src/screens/Workspace.tsx client/src/styles.css tests/client/exam-overview.test.tsx tests/client/workspace.test.tsx
git commit -m "feat: run exams with multiple questions"
```

### Task 9: Add the Groq Whisper server adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server/config.ts`
- Create: `server/transcription.ts`
- Modify: `server/index.ts`
- Modify: `server/app.ts`
- Create: `tests/server/transcription.test.ts`
- Modify: `tests/server/config.test.ts`
- Modify: `tests/server/api.test.ts`

- [ ] **Step 1: Add multipart dependencies**

Run:

```powershell
npm install multer@2.1.1
npm install -D @types/multer@2.1.0
```

Expected: lockfile updated; `npm audit` reports 0 vulnerabilities. If the exact compatible patch differs in the registry, use the installed fixed version and keep it exact in `package.json`.

- [ ] **Step 2: Write failing config/provider tests**

```ts
expect(resolveRuntimeConfig(root, { GROQ_API_KEY: " key " }).speech).toEqual({
  apiKey: "key",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "whisper-large-v3-turbo",
});
```

Provider test injects a fake OpenAI client and asserts `model`, `language: "ru"`, `temperature: 0`, and prompt without the reference answer.

- [ ] **Step 3: Verify RED**

Run: `npm test -- tests/server/config.test.ts tests/server/transcription.test.ts`

Expected: FAIL because speech config/provider do not exist.

- [ ] **Step 4: Extend runtime config**

```ts
speech: groqApiKey ? {
  apiKey: groqApiKey,
  baseUrl: environment.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  model: environment.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
} : null,
```

- [ ] **Step 5: Implement the provider with the existing OpenAI SDK**

```ts
import OpenAI, { toFile } from "openai";

export class GroqTranscriptionProvider implements SpeechTranscriptionProvider {
  async transcribe(input: TranscriptionInput): Promise<{ text: string; model: string }> {
    const file = await toFile(input.buffer, input.fileName, { type: input.mimeType });
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: "ru",
      temperature: 0,
      response_format: "json",
      prompt: input.prompt.slice(0, 900),
    });
    return { text: result.text.trim(), model: this.model };
  }
}
```

The official Groq endpoint and model behavior are documented at `https://console.groq.com/docs/speech-to-text`.

- [ ] **Step 6: Add the protected transcription endpoint**

Configure memory storage and limits:

```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4"].includes(file.mimetype));
  },
});
```

Add `POST /api/transcriptions` with fields `audio` and `questionId`. Resolve the question server-side and build a prompt from subject, display text and `emphasis`; do not include `referenceAnswer`.

Return 503 if speech is unconfigured, 400 for missing/invalid files, 413 for size limit, and 502 for provider failure.

- [ ] **Step 7: Verify GREEN**

Run: `npm test -- tests/server/config.test.ts tests/server/transcription.test.ts tests/server/api.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json server/config.ts server/transcription.ts server/index.ts server/app.ts tests/server/config.test.ts tests/server/transcription.test.ts tests/server/api.test.ts
git commit -m "feat: add Groq speech transcription API"
```

### Task 10: Add editable voice input to the answer editor

**Files:**
- Create: `client/src/hooks/useVoiceInput.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/screens/Workspace.tsx`
- Modify: `client/src/styles.css`
- Create: `tests/client/voice-input.test.tsx`
- Modify: `tests/client/workspace.test.tsx`

- [ ] **Step 1: Write failing voice hook tests**

Stub `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, and `api.transcribe`. Verify state sequence `idle -> recording -> transcribing -> idle`, stream tracks are stopped, and returned text is appended.

```ts
expect(onTranscript).toHaveBeenCalledWith("Распознанный ответ");
expect(api.transcribe).toHaveBeenCalledWith(expect.any(Blob), "q-1");
expect(mockTrack.stop).toHaveBeenCalled();
```

Add error tests for denied microphone and failed API.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/client/voice-input.test.tsx`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Add multipart client API**

Do not use `jsonRequest`, because it forces JSON headers:

```ts
async transcribe(audio: Blob, questionId: string) {
  const body = new FormData();
  body.append("audio", audio, `answer.${audio.type.includes("ogg") ? "ogg" : "webm"}`);
  body.append("questionId", questionId);
  const response = await fetch("/api/transcriptions", { method: "POST", body });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Не удалось распознать речь");
  return payload as { text: string; model: string };
}
```

- [ ] **Step 4: Implement the recorder hook**

Choose the first supported MIME type from `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/webm`. Enforce five minutes with a timeout that calls `stop()`. Always stop media tracks in `finally` and on unmount.

- [ ] **Step 5: Integrate without auto-submit**

Place «Диктовать» beside the word count. On transcript:

```ts
setAnswer((current) => current.trim()
  ? `${current.trimEnd()}\n\n${text}`
  : text,
);
```

Show recording duration and status text. Keep the normal submit button separate and unchanged.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- tests/client/voice-input.test.tsx tests/client/workspace.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add client/src/hooks/useVoiceInput.ts client/src/api.ts client/src/screens/Workspace.tsx client/src/styles.css tests/client/voice-input.test.tsx tests/client/workspace.test.tsx
git commit -m "feat: add editable voice answers"
```

### Task 11: Update E2E coverage for the complete user flow

**Files:**
- Modify: `tests/e2e/workflows.spec.ts`
- Modify: `client/src/api.ts` mock implementation
- Modify: `playwright.config.ts` only if a browser permission is required for the voice mock

- [ ] **Step 1: Replace obsolete E2E expectations**

Remove assertions for the landing hero, Practice mode and Sources tab. Add direct root redirect and two-mode checks.

- [ ] **Step 2: Add a desktop resize scenario**

Use the separators by accessible name, drag each, reload and assert the computed panel widths persist within 2 px. Focus a separator and use `ArrowRight`; double-click and assert default width.

- [ ] **Step 3: Add the three-question exam scenario**

Select `3`, start the mock run, submit final answers for all three questions, assert different question headings, progress `1 из 3` through `3 из 3`, then verify the summary and total XP.

- [ ] **Step 4: Add a voice transcription scenario without a real microphone**

Use `page.addInitScript` to stub `MediaRecorder` and `getUserMedia`; mock API returns Russian text. Assert the text appears in the editor and `review` has not been called until the user presses submit.

- [ ] **Step 5: Preserve tablet and reduced-motion checks**

On tablet assert no separators are visible and both side panels still open through header buttons. Under reduced motion assert progressive AI text is complete immediately and animation durations are zero.

- [ ] **Step 6: Run E2E and fix only observed failures**

Run: `npm run test:e2e`

Expected: desktop and tablet projects PASS with no retries.

- [ ] **Step 7: Commit**

```powershell
git add tests/e2e/workflows.spec.ts client/src/api.ts playwright.config.ts
git commit -m "test: cover redesigned study and exam workflows"
```

### Task 12: Documentation, live provider check and final verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `client/src/screens/Settings.tsx`
- Modify: `client/src/styles.css`

- [ ] **Step 1: Document Groq configuration and privacy**

Add:

```dotenv
GROQ_API_KEY=
GROQ_WHISPER_MODEL=whisper-large-v3-turbo
```

Explain that audio is sent to Groq only after explicit recording, is not persisted locally, and transcription remains editable before submission.

- [ ] **Step 2: Extend Settings status**

Show separate configured/not configured states for answer checking and voice transcription. Do not expose keys or their prefixes. Add a speech connection test only if it can use a bundled sub-second silent fixture without billing ambiguity; otherwise report configuration presence and rely on the first real transcription.

- [ ] **Step 3: Run a live Groq smoke test on a disposable file**

Create a short temporary Russian WAV under `test-results/`, call `/api/transcriptions`, verify non-empty text and model `whisper-large-v3-turbo`, then delete the file and disposable database. Never print `GROQ_API_KEY`.

- [ ] **Step 4: Run the full verification matrix**

```powershell
npm ci
npm run typecheck
npm test
npm run content:validate
npm run build
npm run test:e2e
npm audit
```

Expected:

- typecheck exits 0;
- all Vitest files pass;
- content reports exactly 48 questions and 3 documents;
- production build succeeds;
- desktop/tablet Playwright projects pass;
- audit reports 0 vulnerabilities.

- [ ] **Step 5: Perform visual inspection**

Run production server and capture desktop 1440x1000 plus tablet 1024x900 screenshots of overview, study workspace, exam dialogue and summary. Check panel readability, no clipping, two right tabs, profile in center, recording states and visible separator focus.

- [ ] **Step 6: Verify Git safety and commit**

```powershell
git check-ignore -v .env runtime/virtex.sqlite test-results/
git grep -n -I -E "gsk_|GROQ_API_KEY=[^[:space:]]+|sk-or-v1-" -- ':!.env.example'
git diff --check
git status --short
```

Expected: `.env` and runtime artifacts are ignored; no real keys are tracked; no whitespace errors remain.

```powershell
git add README.md .env.example client/src/screens/Settings.tsx client/src/styles.css
git commit -m "docs: document voice-enabled exam workflow"
```

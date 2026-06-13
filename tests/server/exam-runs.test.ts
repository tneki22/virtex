import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../server/database.js";
import Database from "better-sqlite3";
import {
  activateNextRunItem,
  attachSessionToRunItem,
  completeRunItem,
  createExamRun,
  getExamRun,
} from "../../server/exam-runs.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

function insertSession(database: ReturnType<typeof createDatabase>, id: string, questionId: string) {
  database.prepare(`
    INSERT INTO sessions
      (id, exam_id, question_id, mode, profile_id, status, follow_up_count, created_at)
    VALUES (?, 'exam', ?, 'exam', 'neutral', 'active', 0, '2026-06-13T00:00:00.000Z')
  `).run(id, questionId);
}

describe("exam run repository", () => {
  it("persists and advances an exam run idempotently", () => {
    const database = createDatabase(":memory:");
    createExamRun(database, {
      id: "run-1",
      examId: "exam",
      profileId: "neutral",
      questionIds: ["q1", "q2"],
      createdAt: "2026-06-13T00:00:00.000Z",
    });

    insertSession(database, "session-1", "q1");
    attachSessionToRunItem(database, "run-1", 1, "session-1");
    expect(activateNextRunItem(database, "run-1")?.sessionId).toBe("session-1");

    completeRunItem(database, "session-1", { baseScore: 84, xp: 20 });
    expect(activateNextRunItem(database, "run-1")?.questionId).toBe("q2");

    const run = getExamRun(database, "run-1");
    expect(run?.currentPosition).toBe(2);
    expect(run?.items[0]).toMatchObject({ status: "completed", baseScore: 84, xp: 20 });
    database.close();
  });

  it("applies database migrations more than once", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "virtex-runs-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "virtex.sqlite");

    createDatabase(filePath).close();
    const database = createDatabase(filePath);
    const columns = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "exam_run_id",
      "exam_run_position",
      "kind",
      "title",
      "updated_at",
    ]));
    database.close();
  });

  it("classifies legacy sessions without losing them", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "virtex-legacy-chats-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "virtex.sqlite");
    const legacy = new Database(filePath);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, question_id TEXT NOT NULL,
        mode TEXT NOT NULL, profile_id TEXT NOT NULL, status TEXT NOT NULL,
        follow_up_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        completed_at TEXT
      );
      INSERT INTO sessions VALUES
        ('study-1', 'exam', 'q1', 'study', 'mentor', 'active', 0, '2026-01-01T00:00:00.000Z', NULL),
        ('exam-1', 'exam', 'q2', 'exam', 'strict', 'completed', 0, '2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z');
    `);
    legacy.close();

    const database = createDatabase(filePath);
    const rows = database.prepare("SELECT id, kind, title, updated_at FROM sessions ORDER BY id").all();
    expect(rows).toEqual([
      { id: "exam-1", kind: "exam", title: "Экзамен", updated_at: "2026-01-02T01:00:00.000Z" },
      { id: "study-1", kind: "review", title: "Проверка ответа", updated_at: "2026-01-01T00:00:00.000Z" },
    ]);
    database.close();
  });
});

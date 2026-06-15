import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExamQuestionCount, ExamRun, ExamRunItem } from "../shared/contracts.js";
import { assertExamQuestionCount } from "../shared/exam-run.js";

interface ExamRunRow {
  id: string;
  exam_id: string;
  profile_id: string;
  question_count: number;
  current_position: number;
  status: "active" | "completed";
  created_at: string;
  completed_at: string | null;
}

interface ExamRunItemRow {
  id: string;
  question_id: string;
  position: number;
  status: "pending" | "active" | "completed";
  session_id: string | null;
  base_score: number | null;
  xp: number;
}

function itemFromRow(row: ExamRunItemRow): ExamRunItem {
  return {
    id: row.id,
    questionId: row.question_id,
    position: row.position,
    status: row.status,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.base_score === null ? {} : { baseScore: row.base_score }),
    xp: row.xp,
  };
}

export function getExamRun(database: Database.Database, runId: string): ExamRun | undefined {
  const row = database.prepare("SELECT * FROM exam_runs WHERE id = ?").get(runId) as
    | ExamRunRow
    | undefined;
  if (!row) return undefined;
  const items = database.prepare(
    "SELECT * FROM exam_run_items WHERE run_id = ? ORDER BY position",
  ).all(runId) as ExamRunItemRow[];
  return {
    id: row.id,
    examId: row.exam_id,
    profileId: row.profile_id,
    questionCount: assertExamQuestionCount(row.question_count),
    currentPosition: row.current_position,
    status: row.status,
    items: items.map(itemFromRow),
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

export function createExamRun(
  database: Database.Database,
  input: {
    id: string;
    examId: string;
    profileId: string;
    questionIds: string[];
    createdAt: string;
  },
): ExamRun {
  const questionCount = assertExamQuestionCount(input.questionIds.length);
  const transaction = database.transaction(() => {
    database.prepare(`
      INSERT INTO exam_runs
        (id, exam_id, profile_id, question_count, current_position, status, created_at)
      VALUES (?, ?, ?, ?, 1, 'active', ?)
    `).run(input.id, input.examId, input.profileId, questionCount, input.createdAt);
    const insertItem = database.prepare(`
      INSERT INTO exam_run_items
        (id, run_id, question_id, position, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    input.questionIds.forEach((questionId, index) => {
      insertItem.run(
        randomUUID(),
        input.id,
        questionId,
        index + 1,
        index === 0 ? "active" : "pending",
      );
    });
  });
  transaction();
  return getExamRun(database, input.id)!;
}

export function attachSessionToRunItem(
  database: Database.Database,
  runId: string,
  position: number,
  sessionId: string,
): ExamRunItem {
  const transaction = database.transaction(() => {
    const result = database.prepare(`
      UPDATE exam_run_items
      SET session_id = ?
      WHERE run_id = ? AND position = ? AND status = 'active'
    `).run(sessionId, runId, position);
    if (result.changes !== 1) throw new Error("Active exam run item not found");
    database.prepare(`
      UPDATE sessions SET exam_run_id = ?, exam_run_position = ? WHERE id = ?
    `).run(runId, position, sessionId);
  });
  transaction();
  return getExamRun(database, runId)!.items[position - 1];
}

export function activateNextRunItem(
  database: Database.Database,
  runId: string,
): ExamRunItem | undefined {
  const transaction = database.transaction(() => {
    const active = database.prepare(`
      SELECT * FROM exam_run_items WHERE run_id = ? AND status = 'active' LIMIT 1
    `).get(runId) as ExamRunItemRow | undefined;
    if (active) return itemFromRow(active);

    const pending = database.prepare(`
      SELECT * FROM exam_run_items
      WHERE run_id = ? AND status = 'pending'
      ORDER BY position LIMIT 1
    `).get(runId) as ExamRunItemRow | undefined;
    if (!pending) return undefined;

    database.prepare("UPDATE exam_run_items SET status = 'active' WHERE id = ?")
      .run(pending.id);
    database.prepare("UPDATE exam_runs SET current_position = ? WHERE id = ?")
      .run(pending.position, runId);
    return { ...itemFromRow(pending), status: "active" as const };
  });
  return transaction();
}

export function completeRunItem(
  database: Database.Database,
  sessionId: string,
  result: { baseScore?: number; xp: number; completedAt?: string },
): ExamRun | undefined {
  const transaction = database.transaction(() => {
    const item = database.prepare(
      "SELECT run_id FROM exam_run_items WHERE session_id = ?",
    ).get(sessionId) as { run_id: string } | undefined;
    if (!item) return undefined;

    database.prepare(`
      UPDATE exam_run_items
      SET status = 'completed', base_score = ?, xp = ?
      WHERE session_id = ?
    `).run(result.baseScore ?? null, result.xp, sessionId);

    const remaining = database.prepare(`
      SELECT COUNT(*) AS count FROM exam_run_items
      WHERE run_id = ? AND status != 'completed'
    `).get(item.run_id) as { count: number };
    if (remaining.count === 0) {
      database.prepare(`
        UPDATE exam_runs SET status = 'completed', completed_at = ? WHERE id = ?
      `).run(result.completedAt ?? new Date().toISOString(), item.run_id);
    }
    return getExamRun(database, item.run_id);
  });
  return transaction();
}

export function cancelExamRun(database: Database.Database, runId: string): boolean {
  const transaction = database.transaction(() => {
    const run = database.prepare("SELECT status FROM exam_runs WHERE id = ?").get(runId) as
      | { status: "active" | "completed" }
      | undefined;
    if (!run) return false;
    if (run.status !== "active") {
      throw Object.assign(new Error("Completed exam runs cannot be cancelled"), { status: 409 });
    }

    database.prepare("UPDATE exam_run_items SET session_id = NULL WHERE run_id = ?").run(runId);
    database.prepare("DELETE FROM sessions WHERE exam_run_id = ?").run(runId);
    database.prepare("DELETE FROM exam_runs WHERE id = ?").run(runId);
    return true;
  });
  return transaction();
}

import Database from "better-sqlite3";

export function createDatabase(filePath: string): Database.Database {
  const database = new Database(filePath);
  database.pragma("foreign_keys = ON");
  if (filePath !== ":memory:") database.pragma("journal_mode = WAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      question_id TEXT PRIMARY KEY,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      question_id TEXT PRIMARY KEY,
      bookmarked INTEGER NOT NULL CHECK (bookmarked IN (0, 1)),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      follow_up_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      answer TEXT NOT NULL,
      base_score REAL,
      xp INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      model TEXT,
      package_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

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
      base_score REAL,
      xp INTEGER NOT NULL DEFAULT 0,
      UNIQUE(run_id, position),
      UNIQUE(run_id, question_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reviews_session ON reviews(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_exam_run_items_run ON exam_run_items(run_id, position);
  `);

  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  const sessionColumnNames = new Set(sessionColumns.map((column) => column.name));
  if (!sessionColumnNames.has("exam_run_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN exam_run_id TEXT REFERENCES exam_runs(id)");
  }
  if (!sessionColumnNames.has("exam_run_position")) {
    database.exec("ALTER TABLE sessions ADD COLUMN exam_run_position INTEGER");
  }

  return database;
}

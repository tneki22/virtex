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
      scope_type TEXT NOT NULL DEFAULT 'question' CHECK (scope_type IN ('question', 'document')),
      document_id TEXT,
      mode TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'review' CHECK (kind IN ('tutor', 'review', 'exam', 'document')),
      title TEXT NOT NULL DEFAULT 'Проверка ответа',
      profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      follow_up_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_sources (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      sources_json TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS rag_documents (
      exam_id TEXT NOT NULL,
      package_version TEXT NOT NULL,
      document_id TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      fragment_count INTEGER NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (exam_id, package_version, document_id, embedding_model)
    );

    CREATE TABLE IF NOT EXISTS rag_embeddings (
      exam_id TEXT NOT NULL,
      package_version TEXT NOT NULL,
      document_id TEXT NOT NULL,
      fragment_id TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      page INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      text_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (exam_id, package_version, document_id, fragment_id, embedding_model)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_sources_message ON message_sources(message_id);
    CREATE INDEX IF NOT EXISTS idx_rag_embeddings_document ON rag_embeddings(exam_id, package_version, document_id, embedding_model);
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
  if (!sessionColumnNames.has("scope_type")) {
    database.exec("ALTER TABLE sessions ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'question'");
  }
  if (!sessionColumnNames.has("document_id")) {
    database.exec("ALTER TABLE sessions ADD COLUMN document_id TEXT");
  }
  if (!sessionColumnNames.has("kind")) {
    database.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'review'");
  }
  if (!sessionColumnNames.has("title")) {
    database.exec("ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT 'Проверка ответа'");
  }
  if (!sessionColumnNames.has("updated_at")) {
    database.exec("ALTER TABLE sessions ADD COLUMN updated_at TEXT");
  }
  const sessionSchema = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
    .get() as { sql: string } | undefined;
  if (sessionSchema?.sql.includes("CHECK (kind IN ('tutor', 'review', 'exam'))")) {
    database.pragma("foreign_keys = OFF");
    database.exec(`
      ALTER TABLE sessions RENAME TO sessions_old;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'question' CHECK (scope_type IN ('question', 'document')),
        document_id TEXT,
        mode TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'review' CHECK (kind IN ('tutor', 'review', 'exam', 'document')),
        title TEXT NOT NULL DEFAULT 'РџСЂРѕРІРµСЂРєР° РѕС‚РІРµС‚Р°',
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        follow_up_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        exam_run_id TEXT REFERENCES exam_runs(id),
        exam_run_position INTEGER
      );

      INSERT INTO sessions (
        id, exam_id, question_id, scope_type, document_id, mode, kind, title,
        profile_id, status, follow_up_count, created_at, updated_at, completed_at,
        exam_run_id, exam_run_position
      )
      SELECT
        id, exam_id, question_id, COALESCE(NULLIF(scope_type, ''), 'question'), document_id,
        mode, kind, title, profile_id, status, follow_up_count, created_at,
        COALESCE(NULLIF(updated_at, ''), completed_at, created_at), completed_at,
        exam_run_id, exam_run_position
      FROM sessions_old;

      DROP TABLE sessions_old;
    `);
    database.pragma("foreign_keys = ON");
  }
  database.exec(`
    UPDATE sessions
    SET kind = CASE WHEN mode = 'exam' THEN 'exam' ELSE COALESCE(NULLIF(kind, ''), 'review') END,
        title = CASE WHEN mode = 'exam' THEN 'Экзамен' ELSE COALESCE(NULLIF(title, ''), 'Проверка ответа') END,
        updated_at = COALESCE(NULLIF(updated_at, ''), completed_at, created_at)
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_sessions_question_updated ON sessions(exam_id, question_id, updated_at DESC)");

  return database;
}

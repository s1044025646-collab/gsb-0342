export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS functions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  function_id INTEGER NOT NULL REFERENCES functions(id),
  version_no INTEGER NOT NULL,
  variables_json TEXT NOT NULL,
  on_json TEXT NOT NULL,
  dc_json TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('computed', 'failed')),
  expression TEXT,
  constant TEXT,
  verification_passed INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (function_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_versions_function ON versions(function_id);
`;

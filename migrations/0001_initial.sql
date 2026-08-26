PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  number_year INTEGER NOT NULL,
  publication_year INTEGER NOT NULL,
  publication_month INTEGER NOT NULL,
  title TEXT NOT NULL,
  official_url TEXT NOT NULL UNIQUE,
  article_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_status TEXT NOT NULL DEFAULT 'active',
  catalog_revision INTEGER NOT NULL DEFAULT 0,
  body_status TEXT NOT NULL DEFAULT 'metadata_only' CHECK(body_status IN ('metadata_only','indexed','fetch_blocked','parse_failed','stale')),
  current_source_hash TEXT,
  body_retrieved_at TEXT,
  parser_version TEXT,
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL
);

CREATE INDEX documents_publication_idx ON documents(published_at DESC, id DESC);
CREATE INDEX documents_number_idx ON documents(number_year DESC, sequence DESC);
CREATE INDEX documents_body_status_idx ON documents(body_status);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  r2_html_key TEXT NOT NULL,
  r2_text_key TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  UNIQUE(document_id, source_hash)
);

CREATE TABLE document_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  marker TEXT,
  text TEXT NOT NULL,
  UNIQUE(document_id, source_hash, ordinal),
  FOREIGN KEY(document_id, source_hash)
    REFERENCES document_versions(document_id, source_hash)
    ON DELETE CASCADE
);

CREATE INDEX document_sections_document_idx ON document_sections(document_id, source_hash, ordinal);

CREATE VIRTUAL TABLE document_fts USING fts5(
  document_id UNINDEXED,
  number,
  title,
  body,
  tokenize = 'porter unicode61'
);

CREATE TABLE document_relations (
  source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_number TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('references','changes','cancels','supersedes')),
  evidence TEXT NOT NULL,
  PRIMARY KEY(source_document_id, target_number, relation_type)
);

CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata_seen INTEGER NOT NULL DEFAULT 0,
  metadata_upserted INTEGER NOT NULL DEFAULT 0,
  bodies_indexed INTEGER NOT NULL DEFAULT 0,
  fetch_blocked INTEGER NOT NULL DEFAULT 0,
  parse_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('running','complete','failed'))
);

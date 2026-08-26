CREATE TABLE source_captures (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  raw_source_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  r2_source_key TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL CHECK(retrieval_mode IN ('server_fetch','interactive_browser')),
  byte_count INTEGER NOT NULL,
  capture_source_url TEXT NOT NULL,
  capture_title TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(document_id, raw_source_hash),
  FOREIGN KEY(document_id, source_hash) REFERENCES document_versions(document_id, source_hash)
);

CREATE INDEX source_captures_version_idx ON source_captures(document_id, source_hash, captured_at DESC);

ALTER TABLE document_versions ADD COLUMN capture_source_url TEXT;
ALTER TABLE document_versions ADD COLUMN capture_title TEXT;
ALTER TABLE document_versions ADD COLUMN captured_at TEXT;

CREATE TABLE admin_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('sync_catalog','index_next','import_browser_source')),
  status TEXT NOT NULL CHECK(status IN ('complete','failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX admin_events_created_idx ON admin_events(created_at DESC);

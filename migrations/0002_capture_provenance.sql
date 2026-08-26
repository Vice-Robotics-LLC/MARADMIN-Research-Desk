ALTER TABLE document_versions RENAME COLUMN r2_html_key TO r2_source_key;
ALTER TABLE document_versions ADD COLUMN retrieval_mode TEXT NOT NULL DEFAULT 'server_fetch'
  CHECK(retrieval_mode IN ('server_fetch','interactive_browser'));

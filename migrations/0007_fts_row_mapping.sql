CREATE TABLE document_fts_rows (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  fts_rowid INTEGER NOT NULL UNIQUE
);

INSERT INTO document_fts_rows (document_id, fts_rowid)
SELECT document_id, rowid FROM document_fts;

CREATE TABLE document_sections_v2 (
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

INSERT INTO document_sections_v2 (id, document_id, source_hash, ordinal, marker, text)
SELECT id, document_id, source_hash, ordinal, marker, text
FROM document_sections;

DROP TABLE document_sections;
ALTER TABLE document_sections_v2 RENAME TO document_sections;
CREATE INDEX document_sections_document_idx ON document_sections(document_id, source_hash, ordinal);

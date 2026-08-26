import { fetchOfficialHTML } from "./source-policy";
import { extractMARADMINBody, extractMARADMINRelationScope, extractRelations, PARSER_VERSION, sha256, splitSections } from "./text";

type Candidate = { id: string; number: string; official_url: string; article_id: string; title: string };

type CaptureMode = "server_fetch" | "interactive_browser";
type SourceProvenance = { sourceURL: string; sourceTitle: string; capturedAt: string };

export function classifyIngestFailure(error: unknown): "fetch_blocked" | "parse_failed" {
  const message = error instanceof Error ? error.message : "parse_failed";
  const retryable = message === "source_fetch_blocked"
    || message === "source_empty"
    || /^source_http_(?:4\d{2}|5\d{2})$/.test(message)
    || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
  return retryable ? "fetch_blocked" : "parse_failed";
}

export async function ingestVerifiedSource(
  db: D1Database,
  archive: R2Bucket,
  candidate: Candidate,
  rawSource: string,
  captureMode: CaptureMode,
  provenance: SourceProvenance
): Promise<{ sourceHash: string; sections: number; relations: number }> {
  const body = extractMARADMINBody(rawSource, candidate.number);
  const sourceHash = await sha256(body);
  const rawSourceHash = await sha256(rawSource);
  const retrievedAt = new Date().toISOString();
  const sourceExtension = captureMode === "server_fetch" ? "html" : "txt";
  const sourceContentType = captureMode === "server_fetch" ? "text/html" : "text/plain; charset=utf-8";
  const sourceKey = `raw/${candidate.id}/${sourceHash}/${rawSourceHash}.${sourceExtension}`;
  const textKey = `text/${candidate.id}/${sourceHash}.txt`;
  await Promise.all([
    archive.put(sourceKey, rawSource, {
      httpMetadata: { contentType: sourceContentType },
      customMetadata: { sourceURL: provenance.sourceURL, sourceTitle: provenance.sourceTitle.slice(0, 500), capturedAt: provenance.capturedAt, retrievedAt, captureMode }
    }),
    archive.put(textKey, body, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { sourceURL: provenance.sourceURL, sourceTitle: provenance.sourceTitle.slice(0, 500), capturedAt: provenance.capturedAt, retrievedAt, captureMode }
    })
  ]);
  const sections = splitSections(body);
  const relations = extractRelations(extractMARADMINRelationScope(rawSource, candidate.number), candidate.number);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO document_versions
      (document_id, source_hash, r2_source_key, r2_text_key, retrieved_at, retrieval_mode, parser_version, byte_count,
       capture_source_url, capture_title, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(candidate.id, sourceHash, sourceKey, textKey, retrievedAt, captureMode,
        PARSER_VERSION, new TextEncoder().encode(body).byteLength, provenance.sourceURL, provenance.sourceTitle.slice(0, 500), provenance.capturedAt),
    db.prepare(`INSERT OR IGNORE INTO source_captures
      (document_id, raw_source_hash, source_hash, r2_source_key, retrieved_at, retrieval_mode, byte_count,
       capture_source_url, capture_title, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(candidate.id, rawSourceHash, sourceHash, sourceKey, retrievedAt, captureMode,
        new TextEncoder().encode(rawSource).byteLength, provenance.sourceURL, provenance.sourceTitle.slice(0, 500), provenance.capturedAt)
  ]);

  const identityBindings = [candidate.id, candidate.number, candidate.official_url, candidate.article_id] as const;
  const current = await db.prepare(`SELECT id FROM documents
    WHERE id=? AND number=? AND official_url=? AND article_id=?`).bind(...identityBindings).first();
  if (!current) throw new Error("catalog_identity_changed");

  await db.prepare(`UPDATE documents SET body_status='stale'
    WHERE id=? AND number=? AND official_url=? AND article_id=? AND current_source_hash=?`)
    .bind(...identityBindings, sourceHash).run();
  await db.prepare("DELETE FROM document_sections WHERE document_id = ? AND source_hash = ?")
    .bind(candidate.id, sourceHash).run();
  const sectionStatements = sections.map((section) => db.prepare(`INSERT INTO document_sections
    (document_id, source_hash, ordinal, marker, text) VALUES (?, ?, ?, ?, ?)`)
    .bind(candidate.id, sourceHash, section.ordinal, section.marker, section.text));
  for (let offset = 0; offset < sectionStatements.length; offset += 75) await db.batch(sectionStatements.slice(offset, offset + 75));

  const finalStatements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM document_relations WHERE source_document_id = ?
      AND EXISTS (SELECT 1 FROM documents WHERE id=? AND number=? AND official_url=? AND article_id=?)`)
      .bind(candidate.id, ...identityBindings)
  ];
  for (const relation of relations) finalStatements.push(db.prepare(`INSERT OR IGNORE INTO document_relations
    (source_document_id, target_number, relation_type, evidence)
    SELECT ?, ?, ?, ? WHERE EXISTS
      (SELECT 1 FROM documents WHERE id=? AND number=? AND official_url=? AND article_id=?)`)
    .bind(candidate.id, relation.targetNumber, relation.relationType, relation.evidence, ...identityBindings));
  finalStatements.push(
    db.prepare(`UPDATE document_fts SET number=?, title=?, body=?
      WHERE rowid=(SELECT fts_rowid FROM document_fts_rows WHERE document_id=?)
      AND EXISTS (SELECT 1 FROM documents WHERE id=? AND number=? AND official_url=? AND article_id=?)`)
      .bind(candidate.number, candidate.title, body, candidate.id, ...identityBindings),
    db.prepare(`UPDATE documents SET body_status='indexed', current_source_hash=?, body_retrieved_at=?, parser_version=?
      WHERE id=? AND number=? AND official_url=? AND article_id=?
        AND EXISTS (SELECT 1 FROM document_fts_rows WHERE document_id=documents.id)`)
      .bind(sourceHash, retrievedAt, PARSER_VERSION, ...identityBindings)
  );
  const publication = await db.batch(finalStatements);
  if ((publication.at(-1)?.meta.changes ?? 0) !== 1) throw new Error("catalog_identity_changed");
  return { sourceHash, sections: sections.length, relations: relations.length };
}

export async function ingestNextBodies(
  db: D1Database,
  archive: R2Bucket,
  limit = 5,
  fetcher: typeof fetch = fetch
): Promise<{ indexed: number; blocked: number; failed: number }> {
  const result = await db.prepare(`SELECT id, number, official_url, article_id, title FROM documents
    WHERE body_status IN ('metadata_only','stale','fetch_blocked')
    ORDER BY CASE body_status WHEN 'stale' THEN 0 WHEN 'metadata_only' THEN 1 ELSE 2 END,
      published_at DESC LIMIT ?`).bind(Math.max(1, Math.min(10, limit))).all<Candidate>();
  let indexed = 0; let blocked = 0; let failed = 0;
  for (const candidate of result.results) {
    try {
      const { html, finalURL } = await fetchOfficialHTML(candidate.official_url, fetcher);
      const capturedAt = new Date().toISOString();
      await ingestVerifiedSource(db, archive, candidate, html, "server_fetch", { sourceURL: finalURL, sourceTitle: candidate.title, capturedAt });
      indexed += 1;
    } catch (error) {
      const status = classifyIngestFailure(error);
      try {
        const statements = [db.prepare(`UPDATE documents SET body_status=
          CASE WHEN ?='fetch_blocked' AND current_source_hash IS NOT NULL THEN 'indexed' ELSE ? END
          WHERE id=?`).bind(status, status, candidate.id)];
        if (status === "parse_failed") statements.push(
          db.prepare("DELETE FROM document_relations WHERE source_document_id=?").bind(candidate.id),
          db.prepare(`UPDATE document_fts SET body=''
            WHERE rowid=(SELECT fts_rowid FROM document_fts_rows WHERE document_id=?)`).bind(candidate.id)
        );
        await db.batch(statements);
      } catch {
        console.error(JSON.stringify({ event: "ingest_status_write_failed", id: candidate.id, status }));
        throw error;
      }
      if (status === "fetch_blocked") blocked += 1; else failed += 1;
    }
  }
  return { indexed, blocked, failed };
}

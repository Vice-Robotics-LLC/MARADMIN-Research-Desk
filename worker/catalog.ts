import { validateOfficialURL } from "./source-policy";

type CatalogItem = {
  catalogID: string; number: string; sequence: number; numberYear: number;
  publicationYear: number; publicationMonth: number; title: string; officialURL: string;
  articleID: string; publishedAt: string; sourceStatus: string; firstSeenAt: string;
  lastVerifiedAt: string; revision: number;
};

type CatalogPage = { catalogRevision: number; items: CatalogItem[]; nextCursor?: string | null };

const CATALOG_ORIGIN = "https://maradmin-api.vicerobotics.com";
const CATALOG_PATH = "/v1/catalog/bootstrap";
const MAX_CATALOG_PAGE_BYTES = 2_000_000;

export const DOCUMENT_UPSERT_SQL = `INSERT INTO documents (
  id, number, sequence, number_year, publication_year, publication_month, title,
  official_url, article_id, published_at, source_status, catalog_revision,
  first_seen_at, last_verified_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  body_status=CASE
    WHEN documents.number <> excluded.number
      OR documents.official_url <> excluded.official_url
      OR documents.article_id <> excluded.article_id
    THEN 'stale' ELSE documents.body_status END,
  current_source_hash=CASE
    WHEN documents.number <> excluded.number
      OR documents.official_url <> excluded.official_url
      OR documents.article_id <> excluded.article_id
    THEN NULL ELSE documents.current_source_hash END,
  body_retrieved_at=CASE
    WHEN documents.number <> excluded.number
      OR documents.official_url <> excluded.official_url
      OR documents.article_id <> excluded.article_id
    THEN NULL ELSE documents.body_retrieved_at END,
  parser_version=CASE
    WHEN documents.number <> excluded.number
      OR documents.official_url <> excluded.official_url
      OR documents.article_id <> excluded.article_id
    THEN NULL ELSE documents.parser_version END,
  number=excluded.number, sequence=excluded.sequence, number_year=excluded.number_year,
  publication_year=excluded.publication_year, publication_month=excluded.publication_month,
  title=excluded.title, official_url=excluded.official_url, article_id=excluded.article_id,
  published_at=excluded.published_at, source_status=excluded.source_status,
  catalog_revision=excluded.catalog_revision, last_verified_at=excluded.last_verified_at`;

export function validateCatalogURL(value: string): URL {
  const url = new URL(value);
  if (url.origin !== CATALOG_ORIGIN || url.pathname !== CATALOG_PATH || url.username || url.password || url.port) {
    throw new Error("catalog_source_not_allowed");
  }
  url.hash = "";
  return url;
}

async function readBoundedText(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("catalog_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("catalog_empty");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error("catalog_too_large"); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function finiteDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function validateCatalogItem(input: unknown): CatalogItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_catalog_item");
  const item = input as Record<string, unknown>;
  if (typeof item.catalogID !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.catalogID)) throw new Error("invalid_catalog_item");
  if (typeof item.number !== "string" || !/^\d{3,4}\/\d{2}$/.test(item.number)) throw new Error("invalid_catalog_item");
  if (!Number.isInteger(item.sequence) || Number(item.sequence) < 0 || Number(item.sequence) > 9999) throw new Error("invalid_catalog_item");
  if (!Number.isInteger(item.numberYear) || Number(item.numberYear) < 2003 || Number(item.numberYear) > 2100) throw new Error("invalid_catalog_item");
  if (!Number.isInteger(item.publicationYear) || Number(item.publicationYear) < 2003 || Number(item.publicationYear) > 2100) throw new Error("invalid_catalog_item");
  if (!Number.isInteger(item.publicationMonth) || Number(item.publicationMonth) < 1 || Number(item.publicationMonth) > 12) throw new Error("invalid_catalog_item");
  if (typeof item.title !== "string" || item.title.trim().length < 1 || item.title.length > 600) throw new Error("invalid_catalog_item");
  if (typeof item.articleID !== "string" || !/^\d{1,20}$/.test(item.articleID)) throw new Error("invalid_catalog_item");
  if (typeof item.sourceStatus !== "string" || !/^[a-z_]{1,30}$/i.test(item.sourceStatus)) throw new Error("invalid_catalog_item");
  if (!finiteDate(item.publishedAt) || !finiteDate(item.firstSeenAt) || !finiteDate(item.lastVerifiedAt)) throw new Error("invalid_catalog_item");
  if (!Number.isInteger(item.revision) || Number(item.revision) < 0) throw new Error("invalid_catalog_item");
  if (typeof item.officialURL !== "string") throw new Error("invalid_catalog_item");
  let officialURL: string;
  try { officialURL = validateOfficialURL(item.officialURL).href; }
  catch { throw new Error("invalid_catalog_item"); }
  return {
    catalogID: item.catalogID, number: item.number, sequence: Number(item.sequence), numberYear: Number(item.numberYear),
    publicationYear: Number(item.publicationYear), publicationMonth: Number(item.publicationMonth), title: item.title.trim(),
    officialURL, articleID: item.articleID, publishedAt: item.publishedAt, sourceStatus: item.sourceStatus.toLowerCase(),
    firstSeenAt: item.firstSeenAt, lastVerifiedAt: item.lastVerifiedAt, revision: Number(item.revision)
  };
}

function validatePage(input: unknown): CatalogPage {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_catalog_page");
  const page = input as Record<string, unknown>;
  if (!Number.isInteger(page.catalogRevision) || Number(page.catalogRevision) < 0) throw new Error("invalid_catalog_page");
  if (!Array.isArray(page.items) || page.items.length > 500) throw new Error("invalid_catalog_page");
  if (page.nextCursor !== undefined && page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 500)) throw new Error("invalid_catalog_page");
  return { catalogRevision: Number(page.catalogRevision), items: page.items.map(validateCatalogItem), nextCursor: page.nextCursor as string | null | undefined };
}

export async function syncCatalog(db: D1Database, sourceURL: string, fetcher: typeof fetch = fetch): Promise<{ seen: number; revision: number; truncated: boolean }> {
  const baseURL = validateCatalogURL(sourceURL);
  let cursor: string | null = null;
  let seen = 0;
  let revision = 0;
  for (let pageNumber = 0; pageNumber < 40; pageNumber += 1) {
    const url = new URL(baseURL);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(url, { redirect: "manual", signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status >= 300 && response.status < 400) throw new Error("catalog_redirect_not_allowed");
      if (!response.ok) throw new Error(`catalog_http_${response.status}`);
      const type = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!type.includes("application/json")) throw new Error("catalog_content_type");
      const page = validatePage(JSON.parse(await readBoundedText(response, MAX_CATALOG_PAGE_BYTES)));
      revision = Math.max(revision, page.catalogRevision);
      for (let offset = 0; offset < page.items.length; offset += 40) {
        const statements = page.items.slice(offset, offset + 40).flatMap((item) => [
          db.prepare(DOCUMENT_UPSERT_SQL)
            .bind(item.catalogID, item.number, item.sequence, item.numberYear, item.publicationYear,
              item.publicationMonth, item.title, item.officialURL, item.articleID, item.publishedAt,
              item.sourceStatus, page.catalogRevision, item.firstSeenAt, item.lastVerifiedAt),
          db.prepare(`INSERT INTO document_fts(document_id, number, title, body)
            SELECT ?, ?, ?, '' WHERE NOT EXISTS (SELECT 1 FROM document_fts WHERE document_id = ?)`)
            .bind(item.catalogID, item.number, item.title, item.catalogID),
          db.prepare(`UPDATE document_fts SET number = ?, title = ?,
            body = CASE WHEN (SELECT body_status FROM documents WHERE id = ?) = 'stale' THEN '' ELSE body END
            WHERE document_id = ?`)
            .bind(item.number, item.title, item.catalogID, item.catalogID)
        ]);
        await db.batch(statements);
      }
      seen += page.items.length;
      cursor = page.nextCursor ?? null;
      if (!cursor) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (cursor) console.warn(JSON.stringify({ event: "catalog_sync_truncated", seen, revision }));
  return { seen, revision, truncated: Boolean(cursor) };
}

import type { ApiEnvelope, Coverage, DocumentSummary, EligibilityContext, Evidence } from "../src/shared/types";
import { syncCatalog } from "./catalog";
import { validateBrowserCapturePayload, validateCaptureProvenance } from "./capture";
import { assessSections, validateContext } from "./eligibility";
import { ingestNextBodies, ingestVerifiedSource } from "./ingest";
import { boundedLimit, buildFtsQuery, buildFtsTokens, buildStrictFtsQuery, isDisallowedPeopleQuery, isMessageCentricQuery, rowToSummary } from "./search";
import { maskContacts } from "./text";

interface Env {
  DB: D1Database;
  SOURCE_ARCHIVE: R2Bucket;
  ASSETS: Fetcher;
  CATALOG_SOURCE_URL: string;
  ENVIRONMENT: string;
  MAX_SEARCH_RESULTS: string;
  CATALOG_ADMIN_TOKEN?: string;
  INDEX_ADMIN_TOKEN?: string;
  CAPTURE_IMPORT_TOKEN?: string;
  PUBLIC_RATE_LIMITER: RateLimit;
}

type SectionRow = {
  id: string; number: string; title: string; official_url: string; published_at: string;
  current_source_hash: string; body_retrieved_at: string; marker: string | null; text: string;
};

const API_VERSION = "2026-08-26.10";
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-research-api-version": API_VERSION,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains"
};

const rateWindows = new Map<string, { count: number; resetAt: number }>();

function json<T>(requestID: string, data: T, status = 200): Response {
  return new Response(JSON.stringify({ data, requestID } satisfies ApiEnvelope<T>), { status, headers: API_HEADERS });
}

function error(requestID: string, code: string, status = 400): Response {
  return json(requestID, { error: code }, status);
}

async function opaqueClientKey(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  const bucket = Math.floor(Date.now() / 300_000);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${bucket}:${address}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withinRateLimit(request: Request, ceiling = 60): Promise<boolean> {
  const now = Date.now();
  const key = await opaqueClientKey(request);
  if (rateWindows.size >= 10_000) {
    for (const [existing, window] of rateWindows) if (window.resetAt <= now) rateWindows.delete(existing);
    while (rateWindows.size >= 10_000) {
      const oldest = rateWindows.keys().next().value as string | undefined;
      if (!oldest) break;
      rateWindows.delete(oldest);
    }
  }
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + 300_000 });
    return true;
  }
  current.count += 1;
  return current.count <= ceiling;
}

async function coverage(db: D1Database): Promise<Coverage> {
  const [counts, revision] = await Promise.all([
    db.prepare(`SELECT body_status, COUNT(*) AS count FROM documents GROUP BY body_status`).all<{ body_status: keyof Coverage; count: number }>(),
    db.prepare("SELECT COALESCE(MAX(catalog_revision), 0) AS revision FROM documents").first<{ revision: number }>()
  ]);
  const value: Coverage = { metadata_only: 0, indexed: 0, fetch_blocked: 0, parse_failed: 0, stale: 0, total: 0, catalogRevision: revision?.revision ?? 0 };
  for (const row of counts.results) {
    if (row.body_status in value) value[row.body_status] = row.count;
    value.total += row.count;
  }
  return value;
}

async function searchDocuments(db: D1Database, input: Record<string, unknown>, ceiling: number): Promise<DocumentSummary[]> {
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 180) : "";
  const limit = boundedLimit(typeof input.limit === "number" ? String(input.limit) : null, ceiling);
  const year = Number.isInteger(input.year) && Number(input.year) >= 2003 && Number(input.year) <= 2100 ? Number(input.year) : null;
  const allowedStatuses = new Set(["metadata_only", "indexed", "fetch_blocked", "parse_failed", "stale"]);
  const status = typeof input.status === "string" && allowedStatuses.has(input.status) ? input.status : null;
  if (!query) {
    const where = [year ? "publication_year = ?" : "1=1", status ? "body_status = ?" : "1=1"].join(" AND ");
    const bindings: unknown[] = [];
    if (year) bindings.push(year);
    if (status) bindings.push(status);
    bindings.push(limit);
    const result = await db.prepare(`SELECT * FROM documents WHERE ${where} ORDER BY published_at DESC, id DESC LIMIT ?`).bind(...bindings).all();
    return result.results.map(rowToSummary);
  }
  if (isDisallowedPeopleQuery(query)) throw new Error("people_search_not_supported");
  if (!isMessageCentricQuery(query)) throw new Error("message_centric_query_required");
  const yearClause = year ? "AND d.publication_year = ?" : "";
  const statusClause = status ? "AND d.body_status = ?" : "";
  const runFts = async (fts: string): Promise<DocumentSummary[]> => {
    const bindings: unknown[] = [fts];
    if (year) bindings.push(year);
    if (status) bindings.push(status);
    bindings.push(limit);
    const result = await db.prepare(`SELECT d.*, bm25(document_fts, 0.0, 6.0, 3.0, 1.0) AS rank,
      snippet(document_fts, 3, '<mark>', '</mark>', ' … ', 36) AS snippet
    FROM document_fts JOIN documents d ON d.id = document_fts.document_id
    WHERE document_fts MATCH ? ${yearClause} ${statusClause}
    ORDER BY rank, d.published_at DESC LIMIT ?`).bind(...bindings).all();
    return result.results.map(rowToSummary);
  };
  const broadQuery = buildFtsQuery(query);
  const tokens = buildFtsTokens(query).map((token) => token.slice(1, -1).toLowerCase());
  const allTerms = await runFts(buildStrictFtsQuery(query));
  if (allTerms.length) {
    return [...allTerms].sort((left, right) => Number(right.bodyStatus === "indexed") - Number(left.bodyStatus === "indexed") || (left.rank ?? 0) - (right.rank ?? 0)).slice(0, limit);
  }
  const anchor = [...tokens].sort((left, right) => Number(/\d/.test(right)) - Number(/\d/.test(left)) || right.length - left.length)[0]!;
  const anchored = await runFts(`"${anchor}"`);
  if (/\d/.test(anchor) && anchored.length) {
    return [...anchored].sort((left, right) => Number(right.bodyStatus === "indexed") - Number(left.bodyStatus === "indexed") || (left.rank ?? 0) - (right.rank ?? 0)).slice(0, limit);
  }
  return await runFts(broadQuery);
}

async function documentEvidence(db: D1Database, id: string, limit = 8, query = ""): Promise<Evidence[]> {
  const result = await db.prepare(`SELECT d.id, d.number, d.title, d.official_url, d.published_at,
      d.current_source_hash, d.body_retrieved_at, s.marker, s.text
    FROM document_sections s JOIN documents d ON d.id=s.document_id
    WHERE d.id=? AND d.body_status='indexed' AND s.source_hash=d.current_source_hash
    ORDER BY s.ordinal LIMIT 250`).bind(id).all<SectionRow>();
  const terms = query.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,31}/g)?.slice(0, 12) ?? [];
  const ranked = result.results.map((row, ordinal) => ({
    row,
    ordinal,
    score: terms.reduce((total, term) => total + (row.text.toLowerCase().includes(term) ? 1 : 0), 0)
  })).sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
  const selected = terms.length && ranked.some((item) => item.score > 0)
    ? ranked.filter((item) => item.score > 0).slice(0, limit)
    : ranked.slice(0, limit);
  return selected.map(({ row }) => {
    const lower = row.text.toLowerCase();
    const firstMatch = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? 0;
    const excerptStart = Math.max(0, firstMatch - 300);
    const excerptEnd = Math.min(row.text.length, excerptStart + 900);
    const excerpt = `${excerptStart > 0 ? "… " : ""}${row.text.slice(excerptStart, excerptEnd)}${excerptEnd < row.text.length ? " …" : ""}`;
    return {
    documentID: row.id, number: row.number, title: row.title, officialURL: row.official_url,
    publishedAt: row.published_at, sourceHash: row.current_source_hash,
    retrievedAt: row.body_retrieved_at, section: row.marker ?? "Unnumbered",
    excerpt: maskContacts(excerpt).slice(0, 900)
    };
  });
}

async function readBoundedText(request: Request, maximum: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("request_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error("request_too_large"); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function readSmallJSON(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("invalid_content_type");
  const text = await readBoundedText(request, 8192);
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error("invalid_json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
}

async function readBrowserCapture(request: Request): Promise<{ documentID: string; sourceText: string; sourceURL: string; sourceTitle: string; capturedAt: string }> {
  const maximum = 5 * 1024 * 1024;
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("invalid_content_type");
  const text = await readBoundedText(request, maximum);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("invalid_json"); }
  return validateBrowserCapturePayload(parsed);
}

async function authorizedAdmin(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected))
  ]);
  const left = new Uint8Array(suppliedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

async function auditAdmin(db: D1Database, requestID: string, action: "sync_catalog" | "index_next" | "import_browser_source", status: "complete" | "failed"): Promise<void> {
  await db.prepare("INSERT INTO admin_events (id, action, status, created_at) VALUES (?, ?, ?, ?)")
    .bind(requestID, action, status, new Date().toISOString()).run();
}

async function handleAPI(request: Request, env: Env, requestID: string): Promise<Response> {
  const url = new URL(request.url);
  const edgeRate = await env.PUBLIC_RATE_LIMITER.limit({ key: `${url.pathname}:${await opaqueClientKey(request)}` });
  if (!edgeRate.success) return error(requestID, "rate_limited", 429);
  if (!(await withinRateLimit(request, url.pathname.startsWith("/api/admin/") ? 20 : 60))) return error(requestID, "rate_limited", 429);
  if (request.method === "GET" && url.pathname === "/api/coverage") return json(requestID, await coverage(env.DB));
  if (request.method === "POST" && url.pathname === "/api/search") {
    const max = Math.max(1, Math.min(20, Number.parseInt(env.MAX_SEARCH_RESULTS || "20", 10)));
    return json(requestID, await searchDocuments(env.DB, await readSmallJSON(request), max));
  }
  const documentMatch = url.pathname.match(/^\/api\/documents\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && documentMatch) {
    const document = await env.DB.prepare("SELECT * FROM documents WHERE id=?").bind(documentMatch[1]).first();
    if (!document) return error(requestID, "not_found", 404);
    return json(requestID, { document: rowToSummary(document), evidence: await documentEvidence(env.DB, documentMatch[1]!, 12) });
  }
  const evidenceMatch = url.pathname.match(/^\/api\/documents\/([A-Za-z0-9_-]+)\/evidence$/);
  if (request.method === "POST" && evidenceMatch) {
    const body = await readSmallJSON(request);
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 180) : "";
    if (query && isDisallowedPeopleQuery(query)) return error(requestID, "people_search_not_supported");
    if (query && !isMessageCentricQuery(query)) return error(requestID, "message_centric_query_required");
    const document = await env.DB.prepare("SELECT * FROM documents WHERE id=?").bind(evidenceMatch[1]).first();
    if (!document) return error(requestID, "not_found", 404);
    return json(requestID, { document: rowToSummary(document), evidence: await documentEvidence(env.DB, evidenceMatch[1]!, 12, query) });
  }
  const relationMatch = url.pathname.match(/^\/api\/documents\/([A-Za-z0-9_-]+)\/relations$/);
  if (request.method === "GET" && relationMatch) {
    const rows = await env.DB.prepare(`SELECT relation_type AS relationType, target_number AS targetNumber, evidence
      FROM document_relations r JOIN documents d ON d.id=r.source_document_id
      WHERE r.source_document_id=? AND d.body_status='indexed'
      ORDER BY relation_type, target_number LIMIT 50`).bind(relationMatch[1]).all();
    return json(requestID, rows.results);
  }
  if (request.method === "POST" && url.pathname === "/api/eligibility") {
    const body = await readSmallJSON(request);
    const documentIDs = Array.isArray(body.documentIDs)
      ? body.documentIDs.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)).slice(0, 5)
      : [];
    const context = validateContext(body.context) satisfies EligibilityContext;
    if (!documentIDs.length) return error(requestID, "document_ids_required");
    const placeholders = documentIDs.map(() => "?").join(",");
    const rows = await env.DB.prepare(`SELECT d.id, d.number, d.title, d.official_url, d.published_at,
      d.current_source_hash, d.body_retrieved_at, s.marker, s.text
      FROM document_sections s JOIN documents d ON d.id=s.document_id
      WHERE d.id IN (${placeholders}) AND d.body_status='indexed' AND s.source_hash=d.current_source_hash
      ORDER BY d.published_at DESC, s.ordinal LIMIT 500`)
      .bind(...documentIDs).all<SectionRow>();
    return json(requestID, assessSections(rows.results, context));
  }
  if (request.method === "POST" && url.pathname === "/api/admin/sync-catalog") {
    if (!(await authorizedAdmin(request, env.CATALOG_ADMIN_TOKEN))) return error(requestID, "not_found", 404);
    try { const result = await syncCatalog(env.DB, env.CATALOG_SOURCE_URL); await auditAdmin(env.DB, requestID, "sync_catalog", "complete"); return json(requestID, result); }
    catch (caught) { await auditAdmin(env.DB, requestID, "sync_catalog", "failed"); throw caught; }
  }
  if (request.method === "POST" && url.pathname === "/api/admin/index-next") {
    if (!(await authorizedAdmin(request, env.INDEX_ADMIN_TOKEN))) return error(requestID, "not_found", 404);
    try { const result = await ingestNextBodies(env.DB, env.SOURCE_ARCHIVE, boundedLimit(url.searchParams.get("limit"), 10)); await auditAdmin(env.DB, requestID, "index_next", "complete"); return json(requestID, result); }
    catch (caught) { await auditAdmin(env.DB, requestID, "index_next", "failed"); throw caught; }
  }
  if (request.method === "POST" && url.pathname === "/api/admin/import-browser-source") {
    if (!(await authorizedAdmin(request, env.CAPTURE_IMPORT_TOKEN))) return error(requestID, "not_found", 404);
    try {
      const capture = await readBrowserCapture(request);
      const candidate = await env.DB.prepare("SELECT id, number, official_url, title FROM documents WHERE id=?")
        .bind(capture.documentID).first<{ id: string; number: string; official_url: string; title: string }>();
      if (!candidate) { await auditAdmin(env.DB, requestID, "import_browser_source", "failed"); return error(requestID, "not_found", 404); }
      const provenance = validateCaptureProvenance(capture, candidate);
      const result = await ingestVerifiedSource(env.DB, env.SOURCE_ARCHIVE, candidate, capture.sourceText, "interactive_browser", provenance);
      await auditAdmin(env.DB, requestID, "import_browser_source", "complete");
      return json(requestID, result);
    } catch (caught) { await auditAdmin(env.DB, requestID, "import_browser_source", "failed"); throw caught; }
  }
  return error(requestID, "not_found", 404);
}

function secureAsset(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestID = crypto.randomUUID();
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json(requestID, { status: "ok", apiVersion: API_VERSION, environment: env.ENVIRONMENT });
      if (url.pathname.startsWith("/api/")) return await handleAPI(request, env, requestID);
      return secureAsset(await env.ASSETS.fetch(request));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "internal_error";
      const safe = ["query_required", "message_centric_query_required", "people_search_not_supported", "request_too_large", "invalid_content_type", "invalid_json", "invalid_document_id", "invalid_source_text", "invalid_source_url", "invalid_source_title", "invalid_captured_at", "source_url_mismatch", "source_title_mismatch", "invalid_expected_number", "not_maradmin", "message_number_mismatch", "body_marker_missing", "body_too_short"].includes(message) ? message : "internal_error";
      return error(requestID, safe, safe === "internal_error" ? 500 : 400);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil((async () => {
      try {
        const catalog = await syncCatalog(env.DB, env.CATALOG_SOURCE_URL);
        const ingest = await ingestNextBodies(env.DB, env.SOURCE_ARCHIVE, 10);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO maintenance_events (id,event,status,detail,created_at) VALUES (?,?,?,?,?)")
            .bind(crypto.randomUUID(), "scheduled_refresh", "complete", JSON.stringify({ catalog, ingest }), new Date().toISOString()),
          env.DB.prepare("DELETE FROM maintenance_events WHERE created_at < datetime('now','-90 days')")
        ]);
      } catch (error) {
        try {
          await env.DB.prepare("INSERT INTO maintenance_events (id,event,status,detail,created_at) VALUES (?,?,?,?,?)")
            .bind(crypto.randomUUID(), "scheduled_refresh", "failed", JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }), new Date().toISOString()).run();
        } catch { /* The original refresh error remains authoritative when the diagnostic write also fails. */ }
        throw error;
      }
    })());
  }
} satisfies ExportedHandler<Env>;

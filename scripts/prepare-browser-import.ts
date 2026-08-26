import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMARADMINBody, extractRelations, htmlToPlainText, PARSER_VERSION, sha256, splitSections } from "../worker/text.ts";
import { validateBrowserCapturePayload, validateCaptureProvenance } from "../worker/capture.ts";

type DocumentPayload = {
  data?: {
    document?: {
      id?: string;
      number?: string;
      title?: string;
      officialURL?: string;
    };
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

const [, , captureArgument, documentIDArgument, originArgument = "https://maradmin-research-desk.christian-c08.workers.dev"] = process.argv;
if (!captureArgument || !documentIDArgument) {
  fail("usage: node --experimental-strip-types scripts/prepare-browser-import.ts <capture-envelope.json> <catalog-document-id> [origin]");
}
if (!/^[A-Za-z0-9_-]{1,80}$/.test(documentIDArgument)) fail("invalid_document_id");

const capturePath = resolve(captureArgument);
const origin = new URL(originArgument);
const localOrigin = origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
if (origin.protocol !== "https:" && !(localOrigin && origin.protocol === "http:")) fail("origin_must_be_https");
if (!localOrigin && origin.hostname !== "maradmin-research-desk.christian-c08.workers.dev") fail("origin_not_allowed");

const response = await fetch(new URL(`/api/documents/${documentIDArgument}`, origin), { signal: AbortSignal.timeout(10_000) });
if (!response.ok) fail(`catalog_lookup_failed_${response.status}`);
const declared = Number(response.headers.get("content-length") ?? 0);
if (declared > 256_000) fail("catalog_response_too_large");
const responseText = await response.text();
if (Buffer.byteLength(responseText, "utf8") > 256_000) fail("catalog_response_too_large");
const payload = JSON.parse(responseText) as DocumentPayload;
const document = payload.data?.document;
if (!document?.id || !document.number || !document.title || !document.officialURL) fail("catalog_document_incomplete");
if (document.id !== documentIDArgument) fail("catalog_document_mismatch");

const official = new URL(document.officialURL);
if (official.protocol !== "https:" || !/(^|\.)marines\.mil$/i.test(official.hostname)) fail("catalog_source_not_official");

const captureFile = await readFile(capturePath, "utf8");
if (Buffer.byteLength(captureFile, "utf8") > 5 * 1024 * 1024) fail("capture_file_too_large");
let captureJSON: unknown;
try { captureJSON = JSON.parse(captureFile); } catch { fail("invalid_capture_json"); }
const capture = validateBrowserCapturePayload({ ...(captureJSON as Record<string, unknown>), documentID: documentIDArgument });
const provenance = validateCaptureProvenance(capture, { id: document.id, number: document.number, official_url: document.officialURL, title: document.title });
const sourceText = capture.sourceText;
const body = extractMARADMINBody(sourceText, document.number);
const sourceHash = await sha256(body);
const rawSourceHash = await sha256(sourceText);
const retrievedAt = new Date().toISOString();
const sections = splitSections(body);
const relations = extractRelations(htmlToPlainText(sourceText), document.number);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, ".project-local", "operator-imports", document.id);
const sourceKey = `raw/${document.id}/${sourceHash}/${rawSourceHash}.txt`;
const textKey = `text/${document.id}/${sourceHash}.txt`;
const sourceOutputPath = resolve(outputDirectory, `${rawSourceHash}-source.txt`);
const bodyOutputPath = resolve(outputDirectory, `${sourceHash}-body.txt`);
const sqlOutputPath = resolve(outputDirectory, `${sourceHash}-${rawSourceHash}.sql`);

const statements = [
  "PRAGMA foreign_keys = ON;",
  `DELETE FROM document_sections WHERE document_id=${sql(document.id)} AND source_hash=${sql(sourceHash)};`,
  `DELETE FROM document_relations WHERE source_document_id=${sql(document.id)};`,
  `DELETE FROM document_fts WHERE document_id=${sql(document.id)};`,
  `INSERT OR IGNORE INTO document_versions (document_id, source_hash, r2_source_key, r2_text_key, retrieved_at, retrieval_mode, parser_version, byte_count, capture_source_url, capture_title, captured_at) VALUES (${[
    document.id, sourceHash, sourceKey, textKey, retrievedAt, "interactive_browser", PARSER_VERSION, Buffer.byteLength(body, "utf8"), provenance.sourceURL, provenance.sourceTitle, provenance.capturedAt
  ].map(sql).join(", ")});`,
  `INSERT OR IGNORE INTO source_captures (document_id, raw_source_hash, source_hash, r2_source_key, retrieved_at, retrieval_mode, byte_count, capture_source_url, capture_title, captured_at) VALUES (${[
    document.id, rawSourceHash, sourceHash, sourceKey, retrievedAt, "interactive_browser", Buffer.byteLength(sourceText, "utf8"), provenance.sourceURL, provenance.sourceTitle, provenance.capturedAt
  ].map(sql).join(", ")});`,
  ...sections.map((section) => `INSERT INTO document_sections (document_id, source_hash, ordinal, marker, text) VALUES (${[
    document.id, sourceHash, section.ordinal, section.marker, section.text
  ].map(sql).join(", ")});`),
  ...relations.map((relation) => `INSERT OR IGNORE INTO document_relations (source_document_id, target_number, relation_type, evidence) VALUES (${[
    document.id, relation.targetNumber, relation.relationType, relation.evidence
  ].map(sql).join(", ")});`),
  `INSERT INTO document_fts(document_id, number, title, body) VALUES (${[document.id, document.number, document.title, body].map(sql).join(", ")});`,
  `UPDATE documents SET body_status='indexed', current_source_hash=${sql(sourceHash)}, body_retrieved_at=${sql(retrievedAt)}, parser_version=${sql(PARSER_VERSION)} WHERE id=${sql(document.id)};`,
  ""
];

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await Promise.all([
  writeFile(sourceOutputPath, sourceText, { encoding: "utf8", mode: 0o600 }),
  writeFile(bodyOutputPath, body, { encoding: "utf8", mode: 0o600 }),
  writeFile(sqlOutputPath, statements.join("\n"), { encoding: "utf8", mode: 0o600 })
]);

console.log(JSON.stringify({
  documentID: document.id,
  number: document.number,
  sourceHash,
  rawSourceHash,
  sections: sections.length,
  relations: relations.length,
  sourceKey,
  textKey,
  sourceFile: basename(sourceOutputPath),
  bodyFile: basename(bodyOutputPath),
  sqlFile: basename(sqlOutputPath),
  outputDirectory
}, null, 2));

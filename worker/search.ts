import type { DocumentSummary } from "../src/shared/types";
import { maskContacts } from "./text";

export function buildFtsTokens(value: string): string[] {
  const tokens = value.normalize("NFKC").match(/[a-z0-9]+(?:[/.:-][a-z0-9]+)*/gi)?.slice(0, 12) ?? [];
  if (!tokens.length) throw new Error("query_required");
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`);
}

export function isMessageCentricQuery(query: string): boolean {
  if (/\d{3,4}(?:\/\d{2})?|\b(?:mos|pmos)\s*\d{4}\b/i.test(query)) return true;
  return /\b(?:maradmin|almar|retention|reenlistment|bonus|orders|promotion|eligibility|assignment|aviation|fiscal|mos|rank|component|reserve|active|program|policy|training|guidance|board|education|manpower|message|pay)\b/i.test(query);
}

export function isDisallowedPeopleQuery(query: string): boolean {
  if (/\d{7,12}/.test(query)) return true;
  if (/(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/.test(query)) return true;
  if (/\b\d{3}[ .-]\d{4}\b/.test(query)) return true;
  const explicitLookup = /\b(?:find|lookup|locate|search|show|list|identify|who\s+is|where\s+is)\b[\s\S]{0,80}\b(?:officer|person|individual|email|phone|edipi|dodid)\b/i;
  const unambiguousContactIntent = /(?:\be[- ]?mail\b|\b(?:phone|telephone|mobile|cell|poc|dsn|fax|extension|ext|edipi|dodid)\b)/i;
  if (explicitLookup.test(query) || unambiguousContactIntent.test(query)) return true;

  const researchTerms = new Set([
    "active", "aircraft", "almar", "amount", "assignment", "authority", "aviation", "board", "bonus",
    "campaign", "career", "change", "component", "corps", "current", "duty", "education", "eligibility",
    "document", "enlisted", "fiscal", "fy", "guidance", "health", "incentive", "marine", "maradmin", "manpower", "medical", "message",
    "military", "mos", "officer", "orders", "pay", "permanent", "pmos", "policy", "program", "promotion", "records",
    "rank", "reenlistment", "reserve", "results", "retention", "schedule", "announcement", "selective", "service", "station", "status",
    "training", "travel", "vaccine", "warrant", "year", "zone", "and", "for", "of", "the", "to", "with",
    "find", "identify", "list", "locate", "lookup", "search", "show"
  ]);
  const tokens = query.normalize("NFKC").toLowerCase().match(/[a-z][a-z'’-]{1,30}/g) ?? [];
  const unknown = tokens.filter((token) => !researchTerms.has(token));
  if (/\b(?:find|lookup|locate|search|show|list|identify|who\s+is|where\s+is)\b/i.test(query) && unknown.length >= 2) return true;
  const personSubject = /\b(?:officer|sergeant|corporal|private|colonel|captain|major|general|person|individual)\b/i.test(query);
  const nameLike = /\b[A-Z][a-z'’-]{1,30}\s+[A-Z][a-z'’-]{1,30}\b/.test(query);
  if (/\b(?:name|address|contact)\b/i.test(query) && (personSubject || nameLike)) return true;
  return personSubject && nameLike && unknown.length >= 2;
}

export function buildFtsQuery(value: string): string {
  const tokens = buildFtsTokens(value);
  return tokens.join(" OR ");
}

export function buildStrictFtsQuery(value: string): string {
  const tokens = buildFtsTokens(value);
  return tokens.join(" ");
}

export function boundedLimit(value: string | null, ceiling = 20): number {
  const cap = Number.isFinite(ceiling) ? Math.max(1, Math.trunc(ceiling)) : 20;
  const parsed = Number.parseInt(value ?? "10", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(cap, parsed)) : Math.min(10, cap);
}

export function normalizeSnippet(value: string | null): string | null {
  if (!value) return null;
  return maskContacts(value.replaceAll("<mark>", "").replaceAll("</mark>", "")).slice(0, 700);
}

export function rowToSummary(row: Record<string, unknown>): DocumentSummary {
  return {
    id: String(row.id), number: String(row.number), title: String(row.title),
    officialURL: String(row.official_url), articleID: String(row.article_id),
    publishedAt: String(row.published_at), sourceStatus: String(row.source_status),
    bodyStatus: row.body_status as DocumentSummary["bodyStatus"],
    sourceHash: row.current_source_hash ? String(row.current_source_hash) : null,
    snippet: row.body_status === "indexed" ? normalizeSnippet(row.snippet ? String(row.snippet) : null) : null,
    rank: typeof row.rank === "number" ? row.rank : null
  };
}

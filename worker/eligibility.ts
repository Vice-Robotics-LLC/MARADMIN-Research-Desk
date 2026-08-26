import type { EligibilityContext, EligibilityResult, Evidence } from "../src/shared/types";
import { maskContacts } from "./text";

type SectionRow = {
  id: string; number: string; title: string; official_url: string; published_at: string;
  current_source_hash: string; body_retrieved_at: string; marker: string | null; text: string;
};

export function validateContext(input: unknown): EligibilityContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  const context: EligibilityContext = {};
  if (typeof value.rank === "string" && /^(?:E-[1-9]|O-(?:[1-9]|10)|W-[1-5])$/i.test(value.rank.trim())) context.rank = value.rank.trim().toUpperCase();
  if (typeof value.mos === "string" && /^\d{4}$/.test(value.mos)) context.mos = value.mos;
  if (typeof value.component === "string" && ["active", "reserve", "irr", "smcr", "ar"].includes(value.component)) context.component = value.component as EligibilityContext["component"];
  if (typeof value.zone === "string" && /^[a-e]$/i.test(value.zone)) context.zone = value.zone.toUpperCase();
  if (typeof value.yearsOfService === "number" && Number.isInteger(value.yearsOfService) && value.yearsOfService >= 0 && value.yearsOfService <= 60) context.yearsOfService = value.yearsOfService;
  return context;
}

function matchesContext(key: string, raw: unknown, lower: string): boolean {
  // Callers must pass context produced by validateContext; each value is constrained before dynamic regex construction.
  const value = String(raw).toLowerCase();
  if (key === "rank") return new RegExp(`\\b${value.replace("-", "\\-")}\\b`, "i").test(lower);
  if (key === "mos") return new RegExp(`\\b${value}(?:lm)?\\b`, "i").test(lower);
  if (key === "zone") return new RegExp(`\\bzone\\s+${value}\\b`, "i").test(lower);
  if (key === "yearsOfService") return new RegExp(`\\b${value}\\s+(?:years?|yrs?)\\b`, "i").test(lower);
  if (key === "component") {
    if (value === "active") return /\bactive(?: duty| component)?\b/.test(lower);
    if (value === "reserve") return /\breserve(?: component)?\b/.test(lower);
    return new RegExp(`\\b${value}\\b`, "i").test(lower);
  }
  return false;
}

export function assessSections(rows: SectionRow[], context: EligibilityContext, expectedDocumentIDs: string[] = []): EligibilityResult {
  const supplied = Object.entries(context).filter(([, value]) => value !== undefined);
  const missingContext = supplied.length ? [] : ["rank, MOS, component, zone, or years of service"];
  const evidence: Evidence[] = [];
  let explicitPositive = false;
  let explicitNegative = false;
  for (const row of rows) {
    const lower = row.text.toLowerCase();
    const matches = supplied.filter(([key, raw]) => matchesContext(key, raw, lower));
    if (!matches.length) continue;
    const negative = /\b(?:not(?:\s+(?:currently|yet|otherwise|longer))?\s+eligible|no\s+longer\s+eligible|ineligible|excluded|does\s+not\s+qualify|not\s+authorized)\b/.test(lower);
    if (negative && matches.length === supplied.length) explicitNegative = true;
    if (!negative && /\b(?:eligible|qualif(?:y|ies|ied)|authorized|may receive|applies to)\b/.test(lower) && matches.length === supplied.length) explicitPositive = true;
    if (evidence.length >= 5) continue;
    evidence.push({
      documentID: row.id, number: row.number, title: row.title, officialURL: row.official_url,
      publishedAt: row.published_at, sourceHash: row.current_source_hash,
      retrievedAt: row.body_retrieved_at, section: row.marker ?? "Unnumbered",
      excerpt: maskContacts(row.text).slice(0, 900)
    });
  }
  const coveredDocumentIDs = new Set(rows.map((row) => row.id));
  const hasIncompleteCoverage = expectedDocumentIDs.some((id) => !coveredDocumentIDs.has(id));
  const status = explicitNegative
    ? "not_supported"
    : explicitPositive && !hasIncompleteCoverage
      ? "supported"
      : "unknown";
  const rationale = status === "not_supported"
    ? "The indexed source contains an explicit exclusion matching the supplied context."
    : status === "supported"
      ? "The indexed source contains explicit eligibility language matching every supplied field."
      : hasIncompleteCoverage
        ? "At least one selected message does not have indexed evidence available, so the available sources cannot establish a definitive match."
        : "The available indexed evidence does not establish a definitive match. Review the cited official source and applicable revisions.";
  return {
    status, rationale, missingContext, evidence,
    disclaimer: "Research aid only. This is not an official eligibility, assignment, promotion, or payment determination."
  };
}

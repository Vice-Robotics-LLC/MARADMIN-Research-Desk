// Synthetic API fixtures for the accessibility gate. Every record is fictional and labeled as a
// synthetic fixture; nothing here is an official MARADMIN, and no real person or unit appears.
// The live corpus has no full-text records yet, so these fixtures are the only way to exercise the
// comparison and eligibility states.
import type { BrowserContext, Route } from "playwright";
import type { Coverage, DocumentSummary, EligibilityResult, Evidence } from "../../src/shared/types.ts";

const OFFICIAL = "https://www.marines.mil/News/Messages/Messages-Display/Article";
export const DETAIL_ERROR_ID = "9000017";

function doc(index: number, indexed: boolean, snippet: string | null = null): DocumentSummary {
  const id = String(9000000 + index);
  const number = `${String(900 + index).padStart(3, "0")}/26`;
  return {
    id, number,
    title: indexed
      ? `SYNTHETIC TEST FIXTURE ${index}: FISCAL YEAR 2027 SAMPLE RETENTION BONUS PROGRAM (NOT AN OFFICIAL MESSAGE)`
      : `SYNTHETIC TEST FIXTURE ${index}: SAMPLE CATALOG RECORD WITHOUT BODY TEXT (NOT AN OFFICIAL MESSAGE)`,
    officialURL: `${OFFICIAL}/${id}/synthetic-test-fixture-${index}/`,
    articleID: id,
    publishedAt: new Date(Date.UTC(2026, 8, 20 - Math.floor(index / 3), 12)).toISOString(),
    sourceStatus: "active",
    bodyStatus: indexed ? "indexed" : index % 7 === 3 ? "fetch_blocked" : index % 7 === 5 ? "stale" : "metadata_only",
    sourceHash: indexed ? `synthetic-hash-${index}` : null,
    snippet: indexed ? snippet : null,
    rank: null
  };
}

export const RESULTS: DocumentSummary[] = Array.from({ length: 20 }, (_, index) => doc(index + 1, index < 3,
  index < 3 ? "3. Eligibility. Sample Marines in grade E-5 with PMOS 3044 in zone B are eligible for the synthetic bonus…" : null));

function evidence(item: DocumentSummary, section: string, excerpt: string): Evidence {
  return {
    documentID: item.id, number: item.number, title: item.title, officialURL: item.officialURL,
    publishedAt: item.publishedAt, sourceHash: item.sourceHash ?? "synthetic", retrievedAt: "2026-09-24T12:00:00.000Z",
    section, excerpt
  };
}

export const COVERAGE: Coverage = { metadata_only: 15, indexed: 3, fetch_blocked: 1, parse_failed: 0, stale: 1, total: 20, catalogRevision: 1 };

function detailFor(id: string) {
  const item = RESULTS.find((candidate) => candidate.id === id) ?? RESULTS[0]!;
  const items = item.bodyStatus === "indexed" ? [
    evidence(item, "1.", "Purpose. This synthetic test fixture announces a sample bonus program for accessibility testing only. It is not an official message."),
    evidence(item, "3.a.", "Eligibility. Sample Marines in grade E-5 with PMOS 3044 in zone B are eligible for the synthetic bonus. Contact details are masked: [contact removed]."),
    evidence(item, "3.b.", "Exclusions. Sample Marines in grade E-9 are not eligible for the synthetic bonus.")
  ] : [];
  return { document: item, evidence: items };
}

function eligibility(documentIDs: string[], context: Record<string, unknown>): EligibilityResult {
  const cited = RESULTS.filter((item) => documentIDs.includes(item.id));
  const base = { missingContext: Object.keys(context).length ? [] : ["rank, MOS, component, zone, or years of service"], disclaimer: "Research aid only. This is not an official eligibility, assignment, promotion, or payment determination." };
  if (context.rank === "E-5") return { ...base, status: "supported", rationale: "The indexed source contains explicit eligibility language matching every supplied field.", evidence: cited.map((item) => evidence(item, "3.a.", "Eligibility. Sample Marines in grade E-5 with PMOS 3044 in zone B are eligible for the synthetic bonus.")) };
  if (context.rank === "E-9") return { ...base, status: "not_supported", rationale: "The indexed source contains an explicit exclusion matching the supplied context.", evidence: cited.map((item) => evidence(item, "3.b.", "Exclusions. Sample Marines in grade E-9 are not eligible for the synthetic bonus.")) };
  return { ...base, status: "unknown", rationale: "The available indexed evidence does not establish a definitive match. Review the cited official source and applicable revisions.", evidence: [] };
}

const envelope = (data: unknown) => JSON.stringify({ data, requestID: "synthetic" });

export async function handleApi(route: Route): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const body = (() => { try { return JSON.parse(request.postData() ?? "{}") as Record<string, unknown>; } catch { return {}; } })();
  const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: envelope(data) });
  const fail = (code: string, status = 400) => route.fulfill({ status, contentType: "application/json", body: envelope({ error: code }) });
  if (url.pathname === "/api/coverage") return ok(COVERAGE);
  if (url.pathname === "/api/search") {
    const query = typeof body.query === "string" ? body.query.toLowerCase() : "";
    if (!query) return ok(RESULTS);
    if (/phone|e-?mail/.test(query)) return fail("people_search_not_supported");
    if (query === "hello") return fail("message_centric_query_required");
    if (query.includes("nothingmatches")) return ok([]);
    return ok(RESULTS);
  }
  const documentMatch = url.pathname.match(/^\/api\/documents\/([A-Za-z0-9_-]+)(\/evidence)?$/);
  if (documentMatch) return documentMatch[1] === DETAIL_ERROR_ID ? fail("internal_error", 500) : ok(detailFor(documentMatch[1]!));
  if (url.pathname === "/api/eligibility") {
    const ids = Array.isArray(body.documentIDs) ? body.documentIDs.filter((id): id is string => typeof id === "string") : [];
    return ok(eligibility(ids, (body.context ?? {}) as Record<string, unknown>));
  }
  return fail("not_found", 404);
}

export async function installFixtures(context: BrowserContext): Promise<void> {
  await context.route("**/api/**", handleApi);
}

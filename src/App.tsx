import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { resultCountMessage, searchErrorFor, type SearchError } from "./search-feedback";
import type { ApiEnvelope, Coverage, DocumentSummary, EligibilityContext, EligibilityResult, Evidence } from "./shared/types";

type Detail = { document: DocumentSummary; evidence: Evidence[] };
type DetailState =
  | { status: "idle" }
  | { status: "loading"; item: DocumentSummary }
  | { status: "loaded"; item: DocumentSummary; detail: Detail }
  | { status: "error"; item: DocumentSummary };
type ContextForm = {
  rank: string;
  mos: string;
  component: "" | NonNullable<EligibilityContext["component"]>;
  zone: string;
  yearsOfService: string;
};
type ContextField = keyof ContextForm;

const EMPTY_CONTEXT: ContextForm = { rank: "", mos: "", component: "", zone: "", yearsOfService: "" };
const CONTEXT_LABELS: Record<ContextField, string> = {
  rank: "Rank", mos: "MOS", component: "Component", zone: "Zone", yearsOfService: "Years of service"
};
const CONTEXT_FIELD_IDS: Record<ContextField, string> = {
  rank: "eligibility-rank", mos: "eligibility-mos", component: "eligibility-component", zone: "eligibility-zone", yearsOfService: "eligibility-years-of-service"
};
const ASSESSMENT_LABELS: Record<EligibilityResult["status"], string> = {
  supported: "Supported by indexed evidence",
  not_supported: "Not supported: explicit exclusion found",
  unknown: "Unknown: no definitive match"
};
const MAX_COMPARE = 5;

export function validateContextForm(form: ContextForm): {
  context: EligibilityContext;
  errors: Partial<Record<ContextField, string>>;
  usedFields: string[];
} {
  const context: EligibilityContext = {};
  const errors: Partial<Record<ContextField, string>> = {};
  const rank = form.rank.trim().toUpperCase();
  const mos = form.mos.trim();
  const zone = form.zone.trim().toUpperCase();
  if (rank) {
    if (/^(?:E-[1-9]|O-(?:[1-9]|10)|W-[1-5])$/.test(rank)) context.rank = rank;
    else errors.rank = "Use E-1–E-9, W-1–W-5, or O-1–O-10.";
  }
  if (mos) {
    if (/^\d{4}$/.test(mos)) context.mos = mos;
    else errors.mos = "Enter a four-digit MOS.";
  }
  if (form.component) context.component = form.component;
  if (zone) {
    if (/^[A-E]$/.test(zone)) context.zone = zone;
    else errors.zone = "Use zone A through E.";
  }
  if (form.yearsOfService.trim()) {
    const years = Number(form.yearsOfService);
    if (Number.isInteger(years) && years >= 0 && years <= 60) context.yearsOfService = years;
    else errors.yearsOfService = "Enter a whole number from 0 through 60.";
  }
  return {
    context,
    errors,
    usedFields: (Object.keys(context) as ContextField[]).map((field) => CONTEXT_LABELS[field])
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const envelope = await response.json() as ApiEnvelope<T> & { data?: { error?: string } };
  if (!response.ok) throw new Error(envelope.data?.error ?? "request_failed");
  return envelope.data as T;
}

/** Moves focus after an explicit action and keeps the target on screen in every engine. */
function focusAndReveal(target: HTMLElement | null): void {
  if (!target) return;
  target.focus({ preventScroll: true });
  const rect = target.getBoundingClientRect();
  const stickyOffset = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  // Bring the new content to the top, below the sticky header (scroll-padding), when any of it is hidden.
  if (rect.top < stickyOffset || rect.bottom > window.innerHeight) target.scrollIntoView({ block: "start", inline: "nearest" });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function CoverageBar({ coverage, unavailable }: { coverage: Coverage | null; unavailable: boolean }) {
  if (unavailable) return <p className="coverage skeleton">Corpus coverage is temporarily unavailable.</p>;
  if (!coverage) return <p className="coverage skeleton">Loading corpus coverage…</p>;
  const percentage = coverage.total ? Math.round((coverage.indexed / coverage.total) * 100) : 0;
  return (
    <section className="coverage" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="sr-only">Corpus coverage</h2>
      <div><strong>{coverage.total.toLocaleString()}</strong><span>official catalog records</span></div>
      <div><strong>{coverage.indexed.toLocaleString()}</strong><span>full-text indexed</span></div>
      <div><strong>{percentage}%</strong><span>body coverage</span></div>
      <div><strong>r{coverage.catalogRevision}</strong><span>catalog revision</span></div>
    </section>
  );
}

function StatusPill({ status }: { status: DocumentSummary["bodyStatus"] }) {
  const labels: Record<DocumentSummary["bodyStatus"], string> = {
    indexed: "Full text indexed", metadata_only: "Metadata only", fetch_blocked: "Official fetch blocked",
    parse_failed: "Parser review needed", stale: "Reverification due"
  };
  return <span className={`status status-${status}`}>{labels[status]}</span>;
}

export function App() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<DocumentSummary[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [coverageUnavailable, setCoverageUnavailable] = useState(false);
  const [detailState, setDetailState] = useState<DetailState>({ status: "idle" });
  const [selected, setSelected] = useState<string[]>([]);
  const [contextForm, setContextForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [contextErrors, setContextErrors] = useState<Partial<Record<ContextField, string>>>({});
  const [usedContextFields, setUsedContextFields] = useState<string[]>([]);
  const [assessment, setAssessment] = useState<EligibilityResult | null>(null);
  const [compareError, setCompareError] = useState("");
  const [compareBusy, setCompareBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<SearchError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const searchRequest = useRef(0);
  const detailRequest = useRef(0);
  const userSearched = useRef(false);
  const openerID = useRef<string | null>(null);
  const focusDetail = useRef(false);
  const focusAtOpen = useRef<Element | null>(null);
  const focusAssessment = useRef(false);
  const focusInvalidField = useRef<ContextField | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const assessmentHeading = useRef<HTMLHeadingElement>(null);
  const assessButton = useRef<HTMLButtonElement>(null);

  const search = useCallback(async (searchQuery = query, searchYear = year) => {
    const requestID = ++searchRequest.current;
    setLoading(true);
    const trimmed = searchQuery.trim();
    // Only a slow search gets a "Searching…" status, so a fast one is still announced once.
    const slow = userSearched.current ? setTimeout(() => { if (requestID === searchRequest.current) setAnnouncement("Searching…"); }, 1000) : undefined;
    try {
      const body: Record<string, unknown> = { limit: 20 };
      if (trimmed) body.query = trimmed;
      if (searchYear) body.year = Number(searchYear);
      const nextResults = await request<DocumentSummary[]>("/api/search", { method: "POST", body: JSON.stringify(body) });
      if (requestID !== searchRequest.current) return;
      setResults(nextResults);
      setSearchError(null);
      // One concise status per completed search; the result list itself is not a live region.
      if (userSearched.current) setAnnouncement(resultCountMessage(nextResults.length, trimmed));
    } catch (caught) {
      if (requestID !== searchRequest.current) return;
      const failure = searchErrorFor(caught instanceof Error ? caught.message : "request_failed");
      // A rejected query has no matches; keep earlier results only for transient failures.
      if (failure.queryProblem) setResults([]);
      setSearchError(failure);
      setAnnouncement("");
    } finally {
      clearTimeout(slow);
      if (requestID === searchRequest.current) setLoading(false);
    }
  }, [query, year]);

  useEffect(() => {
    void request<Coverage>("/api/coverage").then(setCoverage).catch(() => setCoverageUnavailable(true));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void search(); }, 260);
    return () => clearTimeout(timer);
  }, [query, year, search]);

  useEffect(() => {
    if (!focusDetail.current || detailState.status === "loading" || detailState.status === "idle") return;
    focusDetail.current = false;
    // Only move focus if it hasn't moved since Open (Safari focuses <main> on click); never steal it mid-task.
    const active = document.activeElement;
    if (active && active !== document.body && active !== focusAtOpen.current && active.id !== `result-${detailState.item.id}`) return;
    focusAndReveal(detailHeading.current);
  }, [detailState]);

  useEffect(() => {
    // Focus after React commits aria-invalid and the error text, so the field is announced with its error.
    const field = focusInvalidField.current;
    if (!field || !contextErrors[field]) return;
    focusInvalidField.current = null;
    document.getElementById(CONTEXT_FIELD_IDS[field])?.focus();
  }, [contextErrors]);

  useEffect(() => {
    if (!focusAssessment.current || !assessment) return;
    focusAssessment.current = false;
    focusAndReveal(assessmentHeading.current);
  }, [assessment]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: Math.max(1, currentYear - 2003 + 1) }, (_, index) => String(currentYear - index));
  }, []);

  async function openDocument(item: DocumentSummary) {
    const requestID = ++detailRequest.current;
    openerID.current = item.id;
    focusDetail.current = true;
    focusAtOpen.current = document.activeElement;
    setAssessment(null);
    setDetailState({ status: "loading", item });
    const trimmed = query.trim();
    try {
      const nextDetail = trimmed
        ? await request<Detail>(`/api/documents/${encodeURIComponent(item.id)}/evidence`, { method: "POST", body: JSON.stringify({ query: trimmed }) })
        : await request<Detail>(`/api/documents/${encodeURIComponent(item.id)}`);
      if (requestID === detailRequest.current) setDetailState({ status: "loaded", item, detail: nextDetail });
    } catch {
      if (requestID === detailRequest.current) setDetailState({ status: "error", item });
    }
  }

  function returnToResults() {
    const opener = openerID.current ? document.getElementById(`result-${openerID.current}`) : null;
    (opener ?? document.getElementById("maradmin-search"))?.focus();
  }

  function clearSelection() {
    // The Clear button disappears with the selection, so focus moves to the always-present Compare button.
    assessButton.current?.focus();
    setSelected([]);
    setCompareError("");
  }

  function toggleSelected(id: string) {
    setCompareError("");
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < MAX_COMPARE ? [...current, id] : current);
  }

  function updateContextField<Field extends ContextField>(field: Field, value: ContextForm[Field]) {
    setContextForm((current) => ({ ...current, [field]: value }));
    setContextErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function assess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (compareBusy) return;
    setCompareError("");
    const validated = validateContextForm(contextForm);
    setContextErrors(validated.errors);
    const invalid = (Object.keys(CONTEXT_FIELD_IDS) as ContextField[]).filter((field) => validated.errors[field]);
    if (invalid.length) {
      // Focus lands on the first invalid field (after render); its description carries the error, so it is read once.
      focusInvalidField.current = invalid[0]!;
      return;
    }
    if (!selected.length) {
      setCompareError("Select at least one full-text indexed message with its Compare checkbox, then compare again.");
      return;
    }
    setCompareBusy(true);
    try {
      const result = await request<EligibilityResult>("/api/eligibility", { method: "POST", body: JSON.stringify({ documentIDs: selected, context: validated.context }) });
      setUsedContextFields(validated.usedFields);
      focusAssessment.current = true;
      setAssessment(result);
    } catch {
      setCompareError("The evidence comparison could not be completed. Try again, or open the official sources directly.");
    } finally {
      setCompareBusy(false);
    }
  }

  const indexedShown = results.filter((item) => item.bodyStatus === "indexed").length;
  const invalidFields = (Object.keys(contextErrors) as ContextField[]).filter((field) => contextErrors[field]);
  const activeID = detailState.status === "idle" ? null : detailState.item.id;
  const describedBy = (field: ContextField, hint: boolean) => [hint ? `${CONTEXT_FIELD_IDS[field]}-hint` : "", contextErrors[field] ? `${CONTEXT_FIELD_IDS[field]}-error` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Public-source research, built for people and agents</p>
        <h1 id="page-title">Find the guidance.<br />See the evidence.</h1>
        <p className="lede">Search official public MARADMIN metadata and indexed text. Every result shows its source coverage, provenance, and official Marines.mil link.</p>
      </section>

      <CoverageBar coverage={coverage} unavailable={coverageUnavailable} />

      <div className="workspace">
        <section className="search-column" aria-labelledby="results-heading">
          <form className="search-controls" role="search" aria-label="MARADMIN catalog" onSubmit={(event) => { event.preventDefault(); userSearched.current = true; void search(); }}>
            <div className="search-box">
              <label htmlFor="maradmin-search" className="sr-only">Search MARADMINs</label>
              <svg className="search-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M15.5 15.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <input id="maradmin-search" name="query" type="search" value={query} autoComplete="off"
                onChange={(event) => { userSearched.current = true; setQuery(event.target.value); }}
                maxLength={180} placeholder="Try ‘reenlistment bonus 3044’ or ‘orders policy’"
                aria-invalid={searchError?.queryProblem ? true : undefined}
                aria-describedby={searchError ? "search-error" : undefined} />
            </div>
            <div>
              <label htmlFor="publication-year" className="sr-only">Publication year</label>
              <span className="select-wrap">
                <select id="publication-year" name="year" value={year} onChange={(event) => { userSearched.current = true; setYear(event.target.value); }}>
                  <option value="">All years</option>{years.map((item) => <option key={item}>{item}</option>)}
                </select>
              </span>
            </div>
          </form>
          {/* Polite, and kept until the next response, so a paused invalid query is announced once rather than re-alerted. */}
          <div role="status">{searchError && <p className="search-error" id="search-error">{searchError.message}</p>}</div>
          <p className="sr-only" role="status" id="search-status">{announcement}</p>
          <div className="result-heading">
            <h2 id="results-heading">{query.trim() ? "Search results" : "Latest MARADMINs"}</h2>
            <span className="result-count">{loading ? "Searching…" : `${results.length} shown`}</span>
          </div>
          {results.length > 0 && (
            <ol className="results">
              {results.map((item) => {
                const active = activeID === item.id;
                const compareDisabled = item.bodyStatus !== "indexed" || (!selected.includes(item.id) && selected.length >= MAX_COMPARE);
                return (
                  <li className={`result${active ? " active" : ""}`} key={item.id}>
                    <button type="button" id={`result-${item.id}`} className="result-main" aria-current={active ? "true" : undefined} onClick={() => void openDocument(item)}>
                      <span className="result-meta"><strong>{item.number}</strong><time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time></span>
                      <span className="result-title">{item.title}</span>
                      {item.snippet && <span className="snippet">{item.snippet}</span>}
                      <span className="tags"><StatusPill status={item.bodyStatus} />{active && <span className="open-tag">Shown in evidence desk</span>}</span>
                    </button>
                    <label className="compare">
                      <input id={`compare-${item.id}`} name="compare" value={item.id} type="checkbox" checked={selected.includes(item.id)} disabled={compareDisabled} onChange={() => toggleSelected(item.id)} />
                      Compare<span className="sr-only"> MARADMIN {item.number}</span>
                    </label>
                  </li>
                );
              })}
            </ol>
          )}
          {!loading && !results.length && !searchError && <p className="empty">No matching official catalog records. Try fewer or broader terms.</p>}
        </section>

        <aside className="research-panel" aria-labelledby="evidence-heading">
          <div className="panel-head">
            <p className="eyebrow">Evidence desk</p>
            <h2 id="evidence-heading" ref={detailHeading} tabIndex={-1}>{detailState.status === "idle" ? "Select a result" : `MARADMIN ${detailState.item.number}`}</h2>
          </div>
          {detailState.status === "idle" && <p className="panel-copy">Choose a message to inspect bounded, contact-masked excerpts and open its authoritative source.</p>}
          {detailState.status === "loading" && <p className="panel-copy">Loading evidence…</p>}
          {detailState.status === "error" && <p className="panel-error">Evidence could not be loaded for this record. Go back to the results to try again, or use the official Marines.mil link.</p>}
          {detailState.status === "loaded" && <>
            <h3>{detailState.detail.document.title}</h3>
            <StatusPill status={detailState.detail.document.bodyStatus} />
            {detailState.detail.evidence.length
              ? <div className="evidence-list">{detailState.detail.evidence.map((item, index) => <blockquote key={`${item.section}-${index}`}><span className="section">{item.section}</span>{item.excerpt}</blockquote>)}</div>
              : <p className="panel-copy">This catalog record does not yet have verified body text. It cannot support a body-derived claim.</p>}
          </>}
          {(detailState.status === "loaded" || detailState.status === "error") && (
            <div className="panel-actions">
              <a className="official-link" href={detailState.status === "loaded" ? detailState.detail.document.officialURL : detailState.item.officialURL} target="_blank" rel="noreferrer">
                Open official Marines.mil source<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button type="button" className="button-secondary" onClick={returnToResults}>Back to result list</button>
            </div>
          )}

          <section className="context-card" aria-labelledby="compare-heading">
            <p className="eyebrow">Session-only context</p>
            <h2 id="compare-heading">Compare selected messages</h2>
            <p>Optional fields are used only for this comparison and are not saved.</p>
            <form noValidate onSubmit={(event) => void assess(event)}>
              <div className="context-grid">
                <div className="context-field">
                  <label htmlFor="eligibility-rank">Rank</label>
                  <input id="eligibility-rank" name="rank" value={contextForm.rank} autoComplete="off" onChange={(e) => updateContextField("rank", e.target.value)} aria-invalid={contextErrors.rank ? true : undefined} aria-describedby={describedBy("rank", true)} />
                  <span className="field-hint" id="eligibility-rank-hint">For example, E-5</span>
                  {contextErrors.rank && <span className="field-error" id="eligibility-rank-error">{contextErrors.rank}</span>}
                </div>
                <div className="context-field">
                  <label htmlFor="eligibility-mos">MOS</label>
                  <input id="eligibility-mos" name="mos" value={contextForm.mos} autoComplete="off" onChange={(e) => updateContextField("mos", e.target.value)} aria-invalid={contextErrors.mos ? true : undefined} aria-describedby={describedBy("mos", true)} inputMode="numeric" maxLength={4} />
                  <span className="field-hint" id="eligibility-mos-hint">Four digits, for example 3044</span>
                  {contextErrors.mos && <span className="field-error" id="eligibility-mos-error">{contextErrors.mos}</span>}
                </div>
                <div className="context-field">
                  <label htmlFor="eligibility-component">Component</label>
                  <span className="select-wrap">
                    <select id="eligibility-component" name="component" value={contextForm.component} onChange={(e) => updateContextField("component", e.target.value as ContextForm["component"])}><option value="">Unspecified</option><option value="active">Active</option><option value="reserve">Reserve</option><option value="smcr">SMCR</option><option value="irr">IRR</option><option value="ar">AR</option></select>
                  </span>
                </div>
                <div className="context-field">
                  <label htmlFor="eligibility-zone">Zone</label>
                  <input id="eligibility-zone" name="zone" value={contextForm.zone} autoComplete="off" onChange={(e) => updateContextField("zone", e.target.value)} aria-invalid={contextErrors.zone ? true : undefined} aria-describedby={describedBy("zone", true)} maxLength={1} />
                  <span className="field-hint" id="eligibility-zone-hint">A through E</span>
                  {contextErrors.zone && <span className="field-error" id="eligibility-zone-error">{contextErrors.zone}</span>}
                </div>
                <div className="context-field">
                  <label htmlFor="eligibility-years-of-service">Years of service</label>
                  <input id="eligibility-years-of-service" name="yearsOfService" inputMode="numeric" value={contextForm.yearsOfService} autoComplete="off" onChange={(e) => updateContextField("yearsOfService", e.target.value)} aria-invalid={contextErrors.yearsOfService ? true : undefined} aria-describedby={describedBy("yearsOfService", true)} />
                  <span className="field-hint" id="eligibility-years-of-service-hint">Whole years, 0 to 60</span>
                  {contextErrors.yearsOfService && <span className="field-error" id="eligibility-years-of-service-error">{contextErrors.yearsOfService}</span>}
                </div>
              </div>
              {invalidFields.length > 0 && <p className="compare-error">Correct {invalidFields.map((field) => CONTEXT_LABELS[field]).join(", ")} before comparing.</p>}
              <p className="compare-status" id="compare-status">
                {selected.length} of {MAX_COMPARE} messages selected. Only full-text indexed messages can be compared{indexedShown ? "." : "; none of the results shown are indexed yet."}
              </p>
              {selected.length > 0 && <button type="button" className="button-secondary" onClick={clearSelection}>Clear selection</button>}
              <div role="alert">{compareError && <p className="compare-error">{compareError}</p>}</div>
              <button type="submit" ref={assessButton} className="assess" aria-describedby="compare-status" aria-disabled={compareBusy ? true : undefined}>
                {compareBusy ? "Comparing…" : `Compare ${selected.length || "selected"} message${selected.length === 1 ? "" : "s"}`}
              </button>
            </form>
            {assessment && (
              <section className={`assessment assessment-${assessment.status}`} aria-labelledby="assessment-heading">
                <p className="eyebrow">Comparison result</p>
                <h3 id="assessment-heading" ref={assessmentHeading} tabIndex={-1}>{ASSESSMENT_LABELS[assessment.status]}</h3>
                <p>{assessment.rationale}</p>
                <p>Compared fields: {usedContextFields.length ? usedContextFields.join(", ") : "None supplied"}.</p>
                <p>{assessment.disclaimer}</p>
                {assessment.evidence.map((item, index) => <blockquote key={`${item.documentID}-${item.section}-${index}`}><span className="section">{item.number} · {item.section}</span>{item.excerpt}</blockquote>)}
              </section>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

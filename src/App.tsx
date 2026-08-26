import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiEnvelope, Coverage, DocumentSummary, EligibilityContext, EligibilityResult, Evidence } from "./shared/types";

type Detail = { document: DocumentSummary; evidence: Evidence[] };
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function CoverageBar({ coverage, unavailable }: { coverage: Coverage | null; unavailable: boolean }) {
  if (unavailable) return <div className="coverage skeleton">Corpus coverage is temporarily unavailable.</div>;
  if (!coverage) return <div className="coverage skeleton">Loading corpus coverage…</div>;
  const percentage = coverage.total ? Math.round((coverage.indexed / coverage.total) * 100) : 0;
  return (
    <section className="coverage" aria-label="Corpus coverage">
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [contextForm, setContextForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [contextErrors, setContextErrors] = useState<Partial<Record<ContextField, string>>>({});
  const [usedContextFields, setUsedContextFields] = useState<string[]>([]);
  const [assessment, setAssessment] = useState<EligibilityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRequest = useRef(0);
  const detailRequest = useRef(0);

  const search = useCallback(async (searchQuery = query, searchYear = year) => {
    const requestID = ++searchRequest.current;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = { limit: 20 };
      if (searchQuery.trim()) body.query = searchQuery.trim();
      if (searchYear) body.year = Number(searchYear);
      const nextResults = await request<DocumentSummary[]>("/api/search", { method: "POST", body: JSON.stringify(body) });
      if (requestID === searchRequest.current) setResults(nextResults);
    } catch (caught) {
      if (requestID !== searchRequest.current) return;
      const message = caught instanceof Error && caught.message === "people_search_not_supported"
        ? "People and contact lookup is not supported. Search by MARADMIN number, MOS, or policy topic."
        : "Search is temporarily unavailable. The official links remain the authoritative source.";
      setError(message);
    } finally {
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

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: Math.max(1, currentYear - 2003 + 1) }, (_, index) => String(currentYear - index));
  }, []);

  async function openDocument(item: DocumentSummary) {
    const requestID = ++detailRequest.current;
    setAssessment(null); setDetail(null); setError(null);
    try {
      const nextDetail = query.trim()
        ? await request<Detail>(`/api/documents/${encodeURIComponent(item.id)}/evidence`, { method: "POST", body: JSON.stringify({ query: query.trim() }) })
        : await request<Detail>(`/api/documents/${encodeURIComponent(item.id)}`);
      if (requestID === detailRequest.current) setDetail(nextDetail);
    }
    catch { if (requestID === detailRequest.current) setError("Evidence could not be loaded for this record."); }
  }

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  }

  function updateContextField<Field extends ContextField>(field: Field, value: ContextForm[Field]) {
    setContextForm((current) => ({ ...current, [field]: value }));
    setContextErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function assess() {
    if (!selected.length) { setError("Select up to five indexed messages before comparing context."); return; }
    const validated = validateContextForm(contextForm);
    setContextErrors(validated.errors);
    if (Object.keys(validated.errors).length) {
      setError("Correct the highlighted context fields before comparing messages.");
      return;
    }
    setError(null);
    try {
      const result = await request<EligibilityResult>("/api/eligibility", { method: "POST", body: JSON.stringify({ documentIDs: selected, context: validated.context }) });
      setUsedContextFields(validated.usedFields);
      setAssessment(result);
    } catch { setError("The evidence comparison could not be completed."); }
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">MR</span><span>MARADMIN Research Desk</span></div>
        <span className="official-note">Unofficial research aid · Official sources linked</span>
      </header>

      <section className="intro">
        <p className="eyebrow">Public-source research, built for people and agents</p>
        <h1>Find the guidance.<br />See the evidence.</h1>
        <p className="lede">Search official public MARADMIN metadata and indexed text. Every result shows its source coverage, provenance, and official Marines.mil link.</p>
      </section>

      <CoverageBar coverage={coverage} unavailable={coverageUnavailable} />

      <section className="workspace">
        <div className="search-column">
          <form className="search-controls" onSubmit={(event) => { event.preventDefault(); void search(); }}>
            <label className="search-box"><span className="sr-only">Search MARADMINs</span><span aria-hidden="true">⌕</span><input id="maradmin-search" name="query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={180} placeholder="Try ‘reenlistment bonus 3044’ or ‘orders policy’" /></label>
            <label><span className="sr-only">Publication year</span><select id="publication-year" name="year" value={year} onChange={(event) => setYear(event.target.value)}><option value="">All years</option>{years.map((item) => <option key={item}>{item}</option>)}</select></label>
          </form>
          <div className="result-heading"><h2>{query ? "Search results" : "Latest MARADMINs"}</h2><span>{loading ? "Searching…" : `${results.length} shown`}</span></div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="results" aria-live="polite">
            {results.map((item) => (
              <article className={`result ${detail?.document.id === item.id ? "active" : ""}`} key={item.id}>
                <button className="result-main" onClick={() => void openDocument(item)}>
                  <span className="result-meta"><strong>{item.number}</strong><time>{formatDate(item.publishedAt)}</time></span>
                  <span className="result-title">{item.title}</span>
                  {item.snippet && <span className="snippet">{item.snippet}</span>}
                  <StatusPill status={item.bodyStatus} />
                </button>
                <label className="compare"><input id={`compare-${item.id}`} name="compare" value={item.id} type="checkbox" checked={selected.includes(item.id)} disabled={item.bodyStatus !== "indexed" || (!selected.includes(item.id) && selected.length >= 5)} onChange={() => toggleSelected(item.id)} /> Compare</label>
              </article>
            ))}
            {!loading && !results.length && <p className="empty">No matching official catalog records. Try fewer or broader terms.</p>}
          </div>
        </div>

        <aside className="research-panel">
          <div className="panel-head"><p className="eyebrow">Evidence desk</p><h2>{detail?.document.number ?? "Select a result"}</h2></div>
          {detail ? <>
            <h3>{detail.document.title}</h3>
            <StatusPill status={detail.document.bodyStatus} />
            {detail.evidence.length ? <div className="evidence-list">{detail.evidence.map((item, index) => <blockquote key={`${item.section}-${index}`}><span>{item.section}</span>{item.excerpt}</blockquote>)}</div> : <p className="panel-copy">This catalog record does not yet have verified body text. It cannot support a body-derived claim.</p>}
            <a className="official-link" href={detail.document.officialURL} target="_blank" rel="noreferrer">Open official Marines.mil source ↗</a>
          </> : <p className="panel-copy">Choose a message to inspect bounded, contact-masked excerpts and open its authoritative source.</p>}

          <div className="context-card">
            <p className="eyebrow">Session-only context</p>
            <p>Optional fields are used only for this comparison and are not saved.</p>
            <div className="context-grid">
              <label>Rank<input id="eligibility-rank" name="rank" value={contextForm.rank} onChange={(e) => updateContextField("rank", e.target.value)} aria-invalid={Boolean(contextErrors.rank)} aria-describedby={contextErrors.rank ? "eligibility-rank-error" : undefined} placeholder="E-5" />{contextErrors.rank && <span className="field-error" id="eligibility-rank-error">{contextErrors.rank}</span>}</label>
              <label>MOS<input id="eligibility-mos" name="mos" value={contextForm.mos} onChange={(e) => updateContextField("mos", e.target.value)} aria-invalid={Boolean(contextErrors.mos)} aria-describedby={contextErrors.mos ? "eligibility-mos-error" : undefined} inputMode="numeric" maxLength={4} placeholder="3044" />{contextErrors.mos && <span className="field-error" id="eligibility-mos-error">{contextErrors.mos}</span>}</label>
              <label>Component<select id="eligibility-component" name="component" value={contextForm.component} onChange={(e) => updateContextField("component", e.target.value as ContextForm["component"])}><option value="">Unspecified</option><option value="active">Active</option><option value="reserve">Reserve</option><option value="smcr">SMCR</option><option value="irr">IRR</option><option value="ar">AR</option></select></label>
              <label>Zone<input id="eligibility-zone" name="zone" value={contextForm.zone} onChange={(e) => updateContextField("zone", e.target.value)} aria-invalid={Boolean(contextErrors.zone)} aria-describedby={contextErrors.zone ? "eligibility-zone-error" : undefined} maxLength={1} placeholder="B" />{contextErrors.zone && <span className="field-error" id="eligibility-zone-error">{contextErrors.zone}</span>}</label>
              <label>Years of service<input id="eligibility-years-of-service" name="yearsOfService" type="number" min="0" max="60" step="1" value={contextForm.yearsOfService} onChange={(e) => updateContextField("yearsOfService", e.target.value)} aria-invalid={Boolean(contextErrors.yearsOfService)} aria-describedby={contextErrors.yearsOfService ? "eligibility-years-error" : undefined} placeholder="6" />{contextErrors.yearsOfService && <span className="field-error" id="eligibility-years-error">{contextErrors.yearsOfService}</span>}</label>
            </div>
            <button className="assess" onClick={() => void assess()}>Compare {selected.length || "selected"} message{selected.length === 1 ? "" : "s"}</button>
          </div>
          {assessment && <section className={`assessment assessment-${assessment.status}`}><p className="eyebrow">{assessment.status.replace("_", " ")}</p><h3>{assessment.rationale}</h3><p>Compared fields: {usedContextFields.length ? usedContextFields.join(", ") : "None supplied"}.</p><p>{assessment.disclaimer}</p>{assessment.evidence.map((item, index) => <blockquote key={`${item.documentID}-${item.section}-${index}`}>{item.number} · {item.section}<br />{item.excerpt}</blockquote>)}</section>}
        </aside>
      </section>

      <footer><p>Published by Vice Robotics, LLC. Not affiliated with or endorsed by the United States Marine Corps.</p><p>WebMCP tools are read-only. Official document text is treated as untrusted source material.</p></footer>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiEnvelope, Coverage, DocumentSummary, EligibilityContext, EligibilityResult, Evidence } from "./shared/types";

type Detail = { document: DocumentSummary; evidence: Evidence[] };

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
  const [context, setContext] = useState<EligibilityContext>({});
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

  async function assess() {
    if (!selected.length) { setError("Select up to five indexed messages before comparing context."); return; }
    setError(null);
    try {
      setAssessment(await request<EligibilityResult>("/api/eligibility", { method: "POST", body: JSON.stringify({ documentIDs: selected, context }) }));
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
              <label>Rank<input id="eligibility-rank" name="rank" value={context.rank ?? ""} onChange={(e) => setContext({ ...context, rank: e.target.value || undefined })} placeholder="E-5" /></label>
              <label>MOS<input id="eligibility-mos" name="mos" value={context.mos ?? ""} onChange={(e) => setContext({ ...context, mos: e.target.value || undefined })} inputMode="numeric" maxLength={4} placeholder="3044" /></label>
              <label>Component<select id="eligibility-component" name="component" value={context.component ?? ""} onChange={(e) => setContext({ ...context, component: (e.target.value || undefined) as EligibilityContext["component"] })}><option value="">Unspecified</option><option value="active">Active</option><option value="reserve">Reserve</option><option value="smcr">SMCR</option><option value="irr">IRR</option><option value="ar">AR</option></select></label>
              <label>Zone<input id="eligibility-zone" name="zone" value={context.zone ?? ""} onChange={(e) => setContext({ ...context, zone: e.target.value || undefined })} maxLength={1} placeholder="B" /></label>
              <label>Years of service<input id="eligibility-years-of-service" name="yearsOfService" type="number" min="0" max="60" step="1" value={context.yearsOfService ?? ""} onChange={(e) => setContext({ ...context, yearsOfService: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="6" /></label>
            </div>
            <button className="assess" onClick={() => void assess()}>Compare {selected.length || "selected"} message{selected.length === 1 ? "" : "s"}</button>
          </div>
          {assessment && <section className={`assessment assessment-${assessment.status}`}><p className="eyebrow">{assessment.status.replace("_", " ")}</p><h3>{assessment.rationale}</h3><p>{assessment.disclaimer}</p>{assessment.evidence.map((item) => <blockquote key={`${item.documentID}-${item.section}`}>{item.number} · {item.section}<br />{item.excerpt}</blockquote>)}</section>}
        </aside>
      </section>

      <footer><p>Published by Vice Robotics, LLC. Not affiliated with or endorsed by the United States Marine Corps.</p><p>WebMCP tools are read-only. Official document text is treated as untrusted source material.</p></footer>
    </main>
  );
}

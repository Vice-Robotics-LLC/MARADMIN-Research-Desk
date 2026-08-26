# PRD — MARADMIN WebMCP Research Desk

## Problem

MARADMINs contain valuable public guidance on retention, bonuses, orders policy, promotions, programs, and eligibility, but the corpus is difficult for a person or agent to search and reconcile across revisions.

## Users and outcome

A service member or researcher can ask a plain-language question, find relevant official messages across the complete catalog, inspect exact evidence, follow changes/cancellations, and open the authoritative source. The product must make uncertainty visible and must not decide a person's official eligibility.

## Success criteria

1. The complete public metadata catalog is discoverable and its body-coverage status is honest.
2. Indexed bodies are searchable by number, title, phrase, MOS, rank, component, and date, with all-term results returned before a broader fallback is attempted.
3. Every body-derived claim contains bounded official evidence and provenance.
4. Revision and cancellation relationships are surfaced before an answer is presented.
5. WebMCP tools are discoverable and executable in a supported HTTPS browser.
6. No raw source, query, profile field, or contact detail leaks through logs or unbounded results.
7. The ordinary human interface remains useful when WebMCP is unavailable.

## Scope

- Public responsive research UI.
- Metadata synchronization from the existing public catalog.
- Official-page ingestion, inert private source snapshots, normalized text, sections, hashes, and a deterministic FTS5 index.
- Read-only WebMCP search, evidence, revision, eligibility, and official-source tools.
- Coverage ledger and source-health reporting.
- Security, parser, API, browser, and WebMCP acceptance evidence.

## Non-goals

- Authentication, profiles, personalized history, AI-generated summaries, personal orders, people lookup, bulk contact export, source uploads, or definitive official advice.
- Changes to the MARADMIN Viewer extension, native app, account backend, notifications, or TestFlight release.

## Primary demonstration

Ask: “Find the current FY27 selective reenlistment bonus guidance relevant to PMOS 3044 for an E-5. Show what the official messages support and what remains unknown.” The agent finds the base message and changes, shows exact evidence, reports revision status, and links to Marines.mil.

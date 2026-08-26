# WebMCP Challenge handoff

## Current official requirements

As verified on August 26, 2026, the [Devpost official rules](https://webmcp.devpost.com/rules) list a September 3, 2026 at 1 p.m. PT registration and submission deadline. Re-check the official rules immediately before submission. The rules require a project description, working live app, public code repository, and a public YouTube demo under three minutes. Registration and submission remain intentionally unperformed until Christian personally accepts the current Devpost terms.

## Working materials

- Live app: <https://maradmin-research-desk.christian-c08.workers.dev>
- Public source repository: <https://github.com/Vice-Robotics-LLC/MARADMIN-Research-Desk>
- License: MIT
- Human experience: anonymous responsive search with explicit corpus coverage, bounded evidence, revision links, and authoritative Marines.mil routing.
- Agent experience: five read-only WebMCP tools registered on the same page and backed by the same provenance-aware APIs.
- Corpus verified August 26, 2026: 16,009 official catalog records, with full-text coverage explicitly labeled per result. The challenge proof indexes MARADMIN 023/26; complete historical body backfill is not claimed.
- Release API candidate: `2026-08-26.12`, with strict all-term search ordering, explicit people-lookup rejection, complete selected-document eligibility coverage, race-safe stale-body invalidation when catalog identity changes, delivered CSP/HSTS headers, and private R2 provenance.

## Two-minute demo script

1. Open the live app and point out that the complete official catalog is searchable while full-text coverage is separately labeled.
2. Search `selective retention bonus 3044` and open MARADMIN 023/26.
3. Show the official-source hash, publication date, evidence section 4.c, the 3044 bonus table evidence, and the link back to Marines.mil.
4. Ask the agent to find the FY27 selective reenlistment bonus guidance for an E-5 in MOS 3044.
5. Let it call `search_maradmins`, `get_maradmin_evidence`, `find_maradmin_revisions`, and `evaluate_maradmin_eligibility`.
6. Show that the agent cites the evidence and MARADMIN 590/25 relationship but returns `unknown` rather than inventing a definitive personal eligibility decision.
7. Close on the security boundary: no account, no saved personnel context, no query analytics, contact-masked excerpts, and read-only tools.

## Submission positioning

MARADMIN Research Desk turns a difficult public-document corpus into a shared human-agent research surface. Its differentiator is not a generated answer; it is evidence discipline. The agent sees the same coverage gaps, official provenance, revision relationships, and uncertainty that the person sees.

## Remaining external actions

- Christian reviews and accepts the current Devpost rules and terms.
- Record and upload the required demo video.
- Enter the final description, live URL, public repository, screenshots, and team information in Devpost.
- Submit before the official deadline.

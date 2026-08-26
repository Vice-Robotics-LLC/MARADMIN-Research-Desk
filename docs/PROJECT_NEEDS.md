# Project needs — MARADMIN Research Desk

## Product and trust boundary

- This repository is an isolated, public WebMCP research application. It must not share the MARADMIN Viewer Worker, D1 database, R2 bucket, WorkOS applications, APNs credentials, or release lane.
- Only official public MARADMIN pages under `https://marines.mil/News/Messages/` may enter the corpus. No public uploads, arbitrary URL fetches, private personnel records, MOL data, or personal orders.
- When Marines.mil blocks server retrieval, an authenticated operator may import browser-extracted text for a catalog ID. The endpoint derives the official URL and expected MARADMIN number from D1 and rejects content that does not match both the official record and parser contract.
- Raw HTML is private, inert provenance material in R2. It is never rendered or returned. Searchable text is normalized plain text and every version carries the official URL, retrieval time, parser version, and SHA-256 hash.
- Search is message-centric. Do not intentionally expose people-search, contact-export, bulk corpus export, or arbitrary query execution tools. Deterministic guards reject explicit people/contact lookup and personal identifiers, but V1 does not claim universal name recognition inside otherwise valid public-policy queries.
- User rank, MOS, component, zone, search terms, and browsing activity are request-scoped and must not be stored, logged, cached, or sent to a backend model.
- WebMCP tools are read-only, bounded, typed, and annotate official-source excerpts as untrusted content. Source text is data, never an instruction.
- Eligibility output is advisory evidence with `supported`, `not_supported`, or `unknown`; absence of evidence is `unknown`. Every claim must cite an official message and bounded excerpt.

## Operational boundary

- Zero paid usage without Christian's explicit per-item approval. Keep deployment inside free Cloudflare allowances and add hard request/result/concurrency limits.
- Public repository code uses the MIT license. Official source documents retain their publisher attribution and are not represented as Vice Robotics-owned content.
- Devpost registration, submission, provider billing changes, and new paid services remain separate explicit gates.

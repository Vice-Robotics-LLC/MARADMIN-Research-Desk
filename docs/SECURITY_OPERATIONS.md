# Security operations

## Cloudflare resource boundary

- Worker: `maradmin-research-desk`
- D1: `maradmin-research-desk`
- Private R2 bucket: `maradmin-research-sources`
- R2 public `r2.dev` access must remain disabled and no custom domain may be attached.
- Persisted Worker request observability is disabled. A private D1 `maintenance_events` ledger retains only daily refresh status and sanitized catalog/ingest counts for 90 days; it never records query bodies, response excerpts, request headers, IP-derived keys, or session-only eligibility context.

Before a public release, verify the R2 boundary with:

```bash
pnpm exec wrangler r2 bucket dev-url get maradmin-research-sources
pnpm exec wrangler r2 bucket domain list maradmin-research-sources
```

The expected results are “disabled” and “no custom domains.”

## Scoped administration

Three independent high-entropy secrets protect separate operations:

- `CATALOG_ADMIN_TOKEN` — metadata synchronization only
- `INDEX_ADMIN_TOKEN` — server-side official-source indexing only
- `CAPTURE_IMPORT_TOKEN` — reviewed browser-capture import only

Rotate a token immediately after suspected disclosure and at least every 90 days. Tokens are never written to repository files, request URLs, D1, audit rows, or logs. Successful and failed authenticated operations create only an action, status, request ID, and timestamp in `admin_events`.

## Browser capture review

Browser capture is a fallback for the external Marines.mil 403, not a public upload feature. The operator must export a JSON envelope containing `sourceText`, the browser's final `sourceURL`, visible `sourceTitle`, and ISO-8601 `capturedAt`. The preparation helper combines that envelope with the selected catalog ID and validates the final URL, title, capture time, and visible message number. The route repeats those checks and rejects a URL/title mismatch; the parser separately rejects a MARADMIN-number mismatch or missing remarks body.

The preparation helper always places generated source, normalized body, and SQL under ignored `.project-local/operator-imports/`. It emits separate semantic-body and raw-capture SHA-256 values so a later capture cannot overwrite earlier provenance. Review both hashes and the summary counts before using Wrangler to upload the two objects and apply the generated D1 statements.

## Retention and takedown

The latest normalized text and its official-source hash are retained while the official catalog record remains active so evidence stays reproducible. Prior raw versions are retained for provenance in V1. If Marines.mil removes or corrects a source, mark the record stale, stop presenting body-derived claims, capture the replacement if available, and remove an affected archived object only through an approved operator change with the article ID and hash recorded in the PR or incident narrative.

## Privacy canary

Before a release candidate, submit a unique message-centric canary query and session-only context, then verify the canary is absent from D1, R2 object metadata, application analytics, and the maintenance ledger. Public excerpts must remain bounded and contact-masked; detected explicit people-centric/contact searches return `people_search_not_supported`, while unrelated non-message queries return `message_centric_query_required`. This deterministic safeguard is deliberately conservative but is not universal entity recognition; public official names may remain visible when browsing a selected message.

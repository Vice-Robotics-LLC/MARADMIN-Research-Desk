# MARADMIN Research Desk

A security-first, public-source research desk for finding official MARADMIN guidance. It combines a human-facing search interface with five bounded, read-only WebMCP tools for agent-assisted research.

Live app: [maradmin-research-desk.christian-c08.workers.dev](https://maradmin-research-desk.christian-c08.workers.dev)

The product is unofficial and is not affiliated with or endorsed by the United States Marine Corps. Every result links back to its official Marines.mil source, identifies its body-coverage state, and prevents metadata-only records from supporting body-derived claims.

## Security and privacy boundary

- The Research Desk has its own Cloudflare Worker, D1 database, private R2 bucket, secrets, domain, and release lane.
- It does not share WorkOS, APNs, account, preference, or user-data infrastructure with MARADMIN Viewer.
- Search and eligibility requests use bounded JSON POST bodies and are not stored by the application.
- Anonymous API requests are bounded by streamed byte limits, parser/result caps, an in-isolate guard, and a Cloudflare edge rate-limiting binding.
- Rank, MOS, component, zone, and years-of-service context are optional, session-only inputs.
- Raw official HTML is private operator evidence in R2. Public APIs expose only contact-masked, bounded excerpts.
- Official document text is always untrusted data. WebMCP tools are read-only and cannot fetch arbitrary URLs, write data, execute code, or chain tools.

## Coverage model

The public catalog may contain more records than the full-text index. Every record is labeled as one of:

- `metadata_only`
- `indexed`
- `fetch_blocked`
- `parse_failed`
- `stale`

This distinction is a product requirement, not an implementation detail. Search results never imply that a document body was inspected when only catalog metadata is available.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

Run the full repository gate before publication:

```bash
pnpm verify
```

An operator can prepare a browser-captured official page for the isolated private index without accepting a caller-supplied URL:

```bash
pnpm prepare:browser-import .project-local/operator-captures/ARTICLE_ID-envelope.json ARTICLE_ID
```

The JSON envelope must contain the browser-observed `sourceURL`, `sourceTitle`, ISO-8601 `capturedAt`, and `sourceText`. The helper validates those values against the catalog record and emits separate immutable hashes for the raw capture and normalized message body.

The command resolves identity and the canonical URL from the deployed catalog, applies the production parser, and creates private R2/D1 import artifacts only under the ignored `.project-local/` directory. It does not upload or publish anything by itself.

See [docs/PRD.md](docs/PRD.md), [docs/PROJECT_NEEDS.md](docs/PROJECT_NEEDS.md), [docs/VERIFY.md](docs/VERIFY.md), [docs/SECURITY_OPERATIONS.md](docs/SECURITY_OPERATIONS.md), and [docs/CHALLENGE_HANDOFF.md](docs/CHALLENGE_HANDOFF.md) for scope, invariants, evidence requirements, operations, and the staged challenge handoff.

## WebMCP tools

- `search_maradmins`
- `get_maradmin_evidence`
- `find_maradmin_revisions`
- `evaluate_maradmin_eligibility`
- `open_official_source`

Tool results retain official-source provenance and explicitly mark source-derived content as untrusted.

## License

MIT. See [LICENSE](LICENSE).

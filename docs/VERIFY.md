# Verification contract

`pnpm verify` is the required local and CI gate. It runs lint, strict TypeScript, focused unit/API/security tests, the browser build, and a production Worker dry run.

Before publication or a completion claim, also prove:

1. End-user search, filters, evidence expansion, revision navigation, and official-link routing in desktop and mobile browser sizes.
2. WebMCP discovery and execution on the deployed HTTPS origin using ChatGPT's in-app browser or WebMCP-enabled Chrome. Ordinary Chrome fallback is not discovery proof.
3. Official-source enforcement rejects off-domain URLs, unsafe redirects, oversized bodies, unsupported content types, and mismatched MARADMIN numbers.
4. Hostile corpus instructions remain quoted data and never trigger a tool, navigation, secret access, or changed eligibility result.
5. A unique rank/MOS/query canary is absent from D1, R2, response caches, application logs, and analytics.
6. The coverage ledger distinguishes `indexed`, `metadata_only`, `fetch_blocked`, `parse_failed`, and `stale`; metadata-only documents never support body claims.

Full historical ingestion is a release-quality gate only after the official source retrieval path is proven. A bounded challenge corpus may demonstrate the product, but coverage must be labeled and cannot be called complete.

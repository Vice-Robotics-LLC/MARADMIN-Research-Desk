# Decisions

## Resolved

- The Research Desk is isolated from MARADMIN Viewer's production resources.
- Search is anonymous and rate-limited; WorkOS is out of scope.
- Search/extraction is deterministic. No backend LLM, generation, embeddings, reranking, or query rewriting is used in V1.
- Raw HTML is private provenance only. The application and WebMCP return bounded plain-text evidence.
- D1 FTS5 is the first index. A measured corpus-size spike decides whether the index is sharded by era or replaced with keyword-only Cloudflare AI Search.
- Contact methods are masked in every public excerpt, including evidence from a specifically identified official message.
- Search is message-centric and uses conservative deterministic heuristics to reject name-only queries, obvious people-centric aliases, long personal identifiers, and contact lookup across both search and evidence-query routes. Selecting a known public message by article ID can still show bounded official text containing public names. Because the product deliberately supports unstructured search over public official text, it does not claim universal named-entity detection or redaction; ambiguous terms can overlap with names, places, and policy vocabulary.
- Raw and normalized official-source archives remain private in R2 with public access disabled; retention exists to preserve cited provenance and uses an operator takedown path.
- The public `workers.dev` hostname is intentional for the challenge deployment because no custom domain is in scope. Admin routes remain undiscoverable-on-failure, independently rate-limited, and protected by operation-specific bearer secrets; a custom-domain WAF is not claimed.
- Semantic body versions and raw captures use separate hashes. Repeated captures cannot overwrite prior raw provenance, while public evidence continues to read only the document's current semantic source hash.

## Open operational gates

- Devpost registration and submission require Christian's explicit agreement to the current rules and terms.
- As verified August 26, 2026, a complete historical body backfill depends on a reliable official retrieval path; ordinary non-browser requests received an external 403. Evidence is retained under ignored `.project-local/evidence/`.
- As verified August 26, 2026 in the ChatGPT in-app browser, all five deployed WebMCP tools were discovered, but automated permission review blocked direct tool invocation. Human UI, HTTPS APIs, schemas, unit execution, and conservative results were verified without bypassing that browser control; local captures are under ignored `.project-local/evidence/`.

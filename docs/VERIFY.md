# Verification contract

`pnpm verify` is the required local and CI gate. It runs lint, strict TypeScript, focused unit/API/security tests, the browser build, a production Worker dry run, and the accessibility gate (`pnpm test:a11y`).

Before publication or a completion claim, also prove:

1. End-user search, filters, evidence expansion, revision navigation, and official-link routing in desktop and mobile browser sizes.
2. WebMCP discovery and execution on the deployed HTTPS origin using ChatGPT's in-app browser or WebMCP-enabled Chrome. Ordinary Chrome fallback is not discovery proof.
3. Official-source enforcement rejects off-domain URLs, unsafe redirects, oversized bodies, unsupported content types, and mismatched MARADMIN numbers.
4. Hostile corpus instructions remain quoted data and never trigger a tool, navigation, secret access, or changed eligibility result.
5. A unique rank/MOS/query canary is absent from D1, R2, response caches, application logs, and analytics.
6. The coverage ledger distinguishes `indexed`, `metadata_only`, `fetch_blocked`, `parse_failed`, and `stale`; metadata-only documents never support body claims.

Full historical ingestion is a release-quality gate only after the official source retrieval path is proven. A bounded challenge corpus may demonstrate the product, but coverage must be labeled and cannot be called complete.

## Accessibility gate

`pnpm test:a11y` (part of `pnpm verify` and CI) implements the Vice Robotics accessibility program (`verification/accessibility/GATES.md` in vice-robotics-operations). The target is WCAG 2.2 Level AA. It needs the Chromium and WebKit builds for Playwright 1.60 (`pnpm exec playwright install chromium webkit`).

- It serves `dist/` through `wrangler dev` over local HTTPS with a throwaway state directory, and answers `/api/*` with the synthetic fixtures in `tests/a11y/fixtures.ts`. The live corpus has no full-text records, so these clearly labeled fake records are the only way to exercise comparison and eligibility. Set `A11Y_BASE_URL` to run the same checks against a deployed origin.
- Routes: `/`, `/accessibility/`, `/support/` and an unknown URL (must return 404 with the not-found page). Desk states: results, empty, both search errors, an opened indexed message, an opened metadata-only message, a detail load error, comparison validation errors, no selection, each comparison result, and the open Display panel.
- Every route and state runs in Chromium and WebKit under Light and Dark (manual and from the device), Enhanced contrast (manual in both appearances and from the device), Reduce Motion (manual and device), Solid backgrounds, and forced colors (Chromium).
- Checks that fail the gate: axe-core 4.13 WCAG 2.2 A/AA violations (exceptions only through the reviewed `tests/a11y/allowlist.json`), focus-indicator contrast at every stop (Option+Tab in WebKit), focus not obscured at 1280×800 and 320×256 in both directions, reflow at 320×640 and 320×256, WCAG text spacing, the token contrast pairs in `tests/a11y/token-pairs.json` for every appearance and Enhanced contrast, titles/`lang`/one `h1`/landmarks/skip link, security.txt, sitemap, CSP (the pre-paint script is allowed only by its hash), the Display settings acceptance checks (JavaScript off, blocked storage, keyboard, accessibility tree, Reset announced once, cross-tab sync, storage holding only display choices), and the result-to-detail and comparison journeys.
- axe "needs review" items are written to `.project-local/a11y/report.json` (uploaded as a CI artifact) for a person to check. Most are text over the intro gradient, which the token pairs measure against the gradient's lightest stop.

Display settings: `<html>` carries the resolved `data-theme`, `data-contrast`, `data-motion` and `data-backgrounds` attributes, set before first paint by `src/chrome/prepaint.ts` and kept current by `src/display/settings.ts`. Without JavaScript, CSS falls back to the media queries. Storage holds only `vice.theme` and `vice.a11y.v1`; never add queries or profile fields to it.

Screen-reader passes (VoiceOver on macOS and iOS, NVDA on Windows) are manual and are scheduled after deployment. Record the date, versions and results on the accessibility page before claiming them.

After a deploy, run the gate against production:

```bash
A11Y_BASE_URL=https://maradmin-research-desk.christian-c08.workers.dev pnpm test:a11y
```

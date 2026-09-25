# PM — MARADMIN Research Desk

The global policy and product boundaries live in `~/Desktop/Vice Robotics/global/AGENT_CONVENTIONS.md`. This ledger records current claims and blockers; prior history is in `archive/`.

## Live claims

_Active coordinators: re-claim current work here on your next turn._

### 2026-09-24 — Accessibility program (WCAG 2.2 AA)

- **Shipped:** PR #4 squash-merged as `d27d33d` and deployed as Worker version `f1eb465c` (coordinator).
  - F08 fixed: an explicit Open moves focus to the evidence heading, and "Back to result list" returns to the result.
  - Also shipped: the Display & accessibility settings, `/accessibility/`, `/support/` with the response-time standard, a real 404, `/.well-known/security.txt` and `sitemap.xml`.
  - `pnpm verify` and CI now run the accessibility gate (`pnpm test:a11y`, Chromium + WebKit).
- **Live results (coordinator, after deploy):**
  - `/accessibility/` returns 200 and `/accessibility` redirects to it.
  - Unknown URLs return 404 with the not-found page. The first probe returned a cached 200 right after deploy; later probes return 404.
  - `security.txt` is served.
  - `A11Y_BASE_URL=https://maradmin-research-desk.christian-c08.workers.dev pnpm test:a11y` passed: 701 assertions, 420 axe runs, 4,872 focus stops, 0 failures.
- **Needs-review items, manually checked on production (2026-09-24):**
  - Covers all 13 axe color-contrast targets: intro eyebrow, title and lede over the gradient; brand and official note on the translucent header; coverage figures; evidence panel; footer links.
  - Rendered background pixels were measured behind each text box in Chromium and WebKit, at 1280 and 320 px, in Light, Dark, Enhanced (both appearances) and Solid (both). Header text was measured at 12 scroll positions.
  - 300 measurements, 0 failures. Lowest normal ratio 5.91:1 (official note); lowest Enhanced 9.31:1 (above the 7:1 target).
  - The display-open items are text covered by the opaque Display panel, which is not applicable.
  - No follow-up fix needed.
- **Open (owner: Christian / accessibility program):**
  - VoiceOver (macOS, iOS) and NVDA passes, then update the accessibility page's tested environments and status.
  - Firefox and real devices untested; Windows contrast themes tested only by Chromium emulation.
  - Comparison can't be exercised live until full-text records are indexed (0 indexed today). It was tested only with synthetic fixtures.
  - Quarterly: re-run the gate against production and update the page's "Last reviewed" date (next by 2026-12-24). `security.txt` `Expires` is 2027-09-01.

## Blockers

_None re-recorded at consolidation. Re-raise any still-live blocker from `archive/` here or in-thread._

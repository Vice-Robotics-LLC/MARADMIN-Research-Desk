import { PREPAINT_SOURCE } from "./prepaint";

// Shared page chrome, injected into every HTML entry at build time (see vite.config.ts), so the header,
// Display control, footer and help links sit in the same place on every page (WCAG 3.2.3, 3.2.6).

export const SUPPORT_EMAIL = "support@vicerobotics.com";

export const PREPAINT_TAG = `<script>${PREPAINT_SOURCE}</script>`;

export const HEADER_HTML = `<a class="skip-link" href="#main">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">MR</span><span>MARADMIN Research Desk</span></a>
      <span class="official-note">Unofficial research aid · Official sources linked</span>
      <div class="display-control">
        <button type="button" class="display-toggle" id="display-toggle" aria-expanded="false" aria-controls="display-panel">Display</button>
        <div class="display-panel" id="display-panel" role="group" aria-labelledby="display-panel-heading" hidden>
          <h2 id="display-panel-heading">Display &amp; accessibility</h2>
          <div data-display-form></div>
        </div>
      </div>
    </header>`;

export const FOOTER_HTML = `<footer class="site-footer">
      <div>
        <p>Published by Vice Robotics, LLC. Not affiliated with or endorsed by the United States Marine Corps.</p>
        <p>WebMCP tools are read-only. Official document text is treated as untrusted source material.</p>
        <p>Questions or an accessibility barrier? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. A person replies within 2 business days.</p>
      </div>
      <nav aria-label="Footer">
        <ul>
          <li><a href="/accessibility/">Accessibility</a></li>
          <li><a href="/support/">Help and contact</a></li>
          <li><a href="https://github.com/Vice-Robotics-LLC/MARADMIN-Research-Desk">Source code</a></li>
        </ul>
      </nav>
    </footer>`;

export function injectChrome(html: string): string {
  const replaced = html
    .replace("<!--chrome:prepaint-->", PREPAINT_TAG)
    .replace("<!--chrome:header-->", HEADER_HTML)
    .replace("<!--chrome:footer-->", FOOTER_HTML);
  if (/<!--chrome:/.test(replaced)) throw new Error("Unresolved chrome placeholder");
  return replaced;
}

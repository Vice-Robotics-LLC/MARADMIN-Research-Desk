// Accessibility release gate (Vice Robotics GATES.md). Run with `pnpm test:a11y` after `pnpm build`.
//
// It serves the built site through `wrangler dev` (or A11Y_BASE_URL for a deployed origin), replaces
// the API with synthetic fixtures, and fails on any regression in Chromium or WebKit. The full report,
// including axe "needs review" items, is written to .project-local/a11y/report.json.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright";
import { PNG } from "pngjs";
import { DETAIL_ERROR_ID, RESULTS, installFixtures } from "./fixtures.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPORT_DIR = path.join(ROOT, ".project-local/a11y");
const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DESKTOP = { width: 1280, height: 800 };
let localTLS = false;
const ONLY = process.env.A11Y_ONLY ? process.env.A11Y_ONLY.split(",") : null;

type Kind = "chromium" | "webkit";
type Storage = { theme?: string; a11y?: Record<string, string> };
type Setting = {
  name: string; colorScheme: "light" | "dark"; contrast?: "more"; reducedMotion?: "reduce"; forcedColors?: "active";
  storage?: Storage; expect: { theme: string; contrast?: boolean; motion?: boolean; backgrounds?: boolean }; chromiumOnly?: boolean;
};
type AllowEntry = { rule: string; selector: string; reason: string; owner: string; reviewBy: string; settings?: string[]; browsers?: string[] };

const SETTINGS: Setting[] = [
  { name: "light-system", colorScheme: "light", expect: { theme: "light" } },
  { name: "dark-system", colorScheme: "dark", expect: { theme: "dark" } },
  { name: "light-manual", colorScheme: "dark", storage: { theme: "light" }, expect: { theme: "light" } },
  { name: "dark-manual", colorScheme: "light", storage: { theme: "dark" }, expect: { theme: "dark" } },
  { name: "more-light", colorScheme: "light", storage: { theme: "light", a11y: { contrast: "more" } }, expect: { theme: "light", contrast: true } },
  { name: "more-dark", colorScheme: "light", storage: { theme: "dark", a11y: { contrast: "more" } }, expect: { theme: "dark", contrast: true } },
  { name: "more-system", colorScheme: "dark", contrast: "more", expect: { theme: "dark", contrast: true } },
  { name: "reduce-motion", colorScheme: "light", storage: { a11y: { motion: "reduce" } }, expect: { theme: "light", motion: true } },
  { name: "reduce-motion-system", colorScheme: "dark", reducedMotion: "reduce", expect: { theme: "dark", motion: true } },
  { name: "solid", colorScheme: "dark", storage: { a11y: { backgrounds: "solid" } }, expect: { theme: "dark", backgrounds: true } },
  { name: "forced", colorScheme: "dark", forcedColors: "active", chromiumOnly: true, expect: { theme: "dark" } }
];
const WALK_SETTINGS = new Set(["light-system", "dark-system", "more-light", "more-dark", "forced"]);

const ROUTES = [
  { path: "/", name: "desk", title: "MARADMIN Research Desk", status: 200 },
  { path: "/accessibility/", name: "accessibility", title: "Accessibility · MARADMIN Research Desk", status: 200 },
  { path: "/support/", name: "support", title: "Help and contact · MARADMIN Research Desk", status: 200 },
  { path: "/no-such-page-a11y/", name: "not-found", title: "Page not found · MARADMIN Research Desk", status: 404 }
];

const failures: string[] = [];
const incomplete = new Map<string, { rule: string; target: string; states: Set<string> }>();
const summary: Record<string, number> = {};
const allowlist = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "allowlist.json"), "utf8")) as { entries: AllowEntry[] }).entries;
const today = new Date().toISOString().slice(0, 10);
for (const entry of allowlist) {
  if (!entry.rule || !entry.selector || !entry.reason || !entry.owner || !entry.reviewBy) failures.push(`allowlist entry incomplete: ${JSON.stringify(entry)}`);
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy) || new Date(`${entry.reviewBy}T00:00:00Z`).toISOString().slice(0, 10) !== entry.reviewBy) failures.push(`allowlist reviewBy is not a real YYYY-MM-DD date: ${entry.reviewBy}`);
  else if (entry.reviewBy < today) failures.push(`allowlist entry expired ${entry.reviewBy}: ${entry.rule} ${entry.selector}`);
}

function fail(message: string): void { failures.push(message); }
function count(key: string): void { summary[key] = (summary[key] ?? 0) + 1; }
function check(condition: unknown, message: string): void { count("assertions"); if (!condition) fail(message); }

// ---------- server ----------
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))); });
  });
}

async function startServer(): Promise<{ base: string; stop: () => void }> {
  if (process.env.A11Y_BASE_URL) return { base: process.env.A11Y_BASE_URL.replace(/\/$/, ""), stop: () => undefined };
  if (!fs.existsSync(path.join(ROOT, "dist/index.html"))) throw new Error("dist/ is missing. Run `pnpm build` before `pnpm test:a11y`.");
  const port = await freePort();
  // A private, throwaway local state directory so parallel runs never share workerd storage.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-desk-a11y-"));
  const child: ChildProcess = spawn(path.join(ROOT, "node_modules/.bin/wrangler"), ["dev", "--port", String(port), "--ip", "127.0.0.1", "--local-protocol", "https", "--persist-to", stateDir, "--show-interactive-dev-session=false"], {
    cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" }
  });
  let log = "";
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { log += chunk; });
  // HTTPS locally, because the CSP's upgrade-insecure-requests makes WebKit upgrade http://127.0.0.1 subresources.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  localTLS = true;
  const base = `https://127.0.0.1:${port}`;
  const stop = () => {
    try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* removed by the OS later */ }
  };
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return { base, stop }; } catch { /* not ready */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop();
  throw new Error(`wrangler dev did not start:\n${log.slice(-2000)}`);
}

// ---------- browser helpers ----------
async function newContext(browser: Browser, kind: Kind, setting: Setting, viewport = DESKTOP, extra: BrowserContextOptions = {}): Promise<BrowserContext> {
  const options: BrowserContextOptions = {
    viewport, colorScheme: setting.colorScheme, reducedMotion: setting.reducedMotion ?? "no-preference",
    contrast: setting.contrast ?? "no-preference", bypassCSP: true, ignoreHTTPSErrors: localTLS, ...extra
  };
  if (kind === "chromium") options.forcedColors = setting.forcedColors ?? "none";
  const context = await browser.newContext(options);
  await installFixtures(context);
  if (setting.storage) {
    await context.addInitScript((storage: Storage) => {
      try {
        if (storage.theme) localStorage.setItem("vice.theme", storage.theme);
        if (storage.a11y) localStorage.setItem("vice.a11y.v1", JSON.stringify(storage.a11y));
      } catch { /* storage unavailable */ }
    }, setting.storage);
  }
  return context;
}

async function load(page: Page, base: string, route: string): Promise<number> {
  const response = await page.goto(base + route, { waitUntil: "load" });
  if (route === "/") {
    await page.waitForSelector(".results li");
    await page.waitForSelector(".coverage strong");
    await waitIdle(page);
  }
  await page.mouse.move(1, 1);
  return response?.status() ?? 0;
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => document.querySelector(".result-count")?.textContent !== "Searching…");
}

async function typeQuery(page: Page, query: string): Promise<void> {
  await page.fill("#maradmin-search", query);
  await waitIdle(page);
}

async function openResult(page: Page, id: string): Promise<void> {
  await page.click(`#result-${id}`);
  await page.waitForFunction(() => document.activeElement?.id === "evidence-heading");
}

async function submitCompare(page: Page): Promise<void> {
  await page.click(".assess");
  await page.waitForTimeout(250);
}

const DESK_STATES: Record<string, (page: Page) => Promise<void>> = {
  home: async () => undefined,
  results: async (page) => typeQuery(page, "reenlistment bonus"),
  "detail-indexed": async (page) => openResult(page, RESULTS[0]!.id),
  "detail-metadata": async (page) => openResult(page, RESULTS[5]!.id),
  "detail-error": async (page) => openResult(page, DETAIL_ERROR_ID),
  "search-unsupported": async (page) => { await typeQuery(page, "hello"); await page.waitForSelector("#search-error"); },
  "search-people": async (page) => { await typeQuery(page, "contact phone"); await page.waitForSelector("#search-error"); },
  empty: async (page) => { await typeQuery(page, "nothingmatches policy"); await page.waitForSelector(".empty"); },
  "compare-invalid": async (page) => { await page.fill("#eligibility-rank", "E5"); await page.fill("#eligibility-zone", "Q"); await submitCompare(page); },
  "compare-none-selected": async (page) => { await submitCompare(page); await page.waitForSelector(".compare-error"); },
  "compare-supported": async (page) => compare(page, "E-5"),
  "compare-unknown": async (page) => compare(page, "E-1"),
  "compare-not-supported": async (page) => compare(page, "E-9"),
  "display-open": async (page) => { await page.click("#display-toggle"); }
};
const STATIC_STATES: Record<string, (page: Page) => Promise<void>> = {
  default: async () => undefined,
  "display-open": async (page) => { await page.click("#display-toggle"); }
};

async function compare(page: Page, rank: string): Promise<void> {
  await page.check(`#compare-${RESULTS[0]!.id}`);
  await page.check(`#compare-${RESULTS[1]!.id}`);
  await page.fill("#eligibility-rank", rank);
  await page.fill("#eligibility-mos", "3044");
  await submitCompare(page);
  await page.waitForSelector("#assessment-heading");
}

type AxeNode = { target: string; html: string; summary: string };
type AxeRule = { id: string; nodes: AxeNode[] };

async function axe(page: Page, label: string, setting: string, kind: Kind): Promise<void> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(async (tags: string[]) => {
    const engine = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown[]; html: string; failureSummary?: string }> }>; incomplete: Array<{ id: string; nodes: Array<{ target: unknown[]; html: string; failureSummary?: string }> }> }> } }).axe;
    const run = await engine.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    const slim = (rules: typeof run.violations) => rules.map((rule) => ({ id: rule.id, nodes: rule.nodes.map((node) => ({ target: node.target.map(String).join(" "), html: node.html.slice(0, 160), summary: (node.failureSummary ?? "").slice(0, 300) })) }));
    return { violations: slim(run.violations), incomplete: slim(run.incomplete) };
  }, WCAG_TAGS) as { violations: AxeRule[]; incomplete: AxeRule[] };
  count("axe runs");
  for (const rule of result.violations) {
    for (const node of rule.nodes) {
      const allowed = allowlist.some((entry) => entry.rule === rule.id && entry.selector === node.target && (!entry.settings || entry.settings.includes(setting)) && (!entry.browsers || entry.browsers.includes(kind)));
      if (!allowed) fail(`axe ${rule.id} @ ${label}: ${node.target} — ${node.summary.split("\n").slice(0, 2).join(" ")}`);
    }
  }
  for (const rule of result.incomplete) {
    for (const node of rule.nodes) {
      const key = `${rule.id}|${node.target}`;
      const entry = incomplete.get(key) ?? { rule: rule.id, target: node.target, states: new Set<string>() };
      entry.states.add(label);
      incomplete.set(key, entry);
    }
  }
}

async function reflow(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders = root.scrollWidth > root.clientWidth
      ? [...document.querySelectorAll("body *")].filter((node) => node.getBoundingClientRect().right > root.clientWidth + 1 && getComputedStyle(node).position !== "fixed").slice(0, 5).map((node) => `${node.tagName.toLowerCase()}.${String((node as HTMLElement).className)}`)
      : [];
    return { scroll: root.scrollWidth, client: root.clientWidth, offenders };
  });
  count("reflow checks");
  if (result.scroll > result.client) fail(`reflow @ ${label}: scrollWidth ${result.scroll} > ${result.client} (${result.offenders.join(", ")})`);
}

const SPACING_CSS = "*:not(svg):not(svg *){line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-bottom:2em !important}";
async function textSpacing(page: Page, label: string): Promise<void> {
  await page.evaluate((css) => { const style = document.createElement("style"); style.id = "a11y-spacing"; style.textContent = css; document.head.appendChild(style); }, SPACING_CSS);
  await page.waitForTimeout(60);
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || node.closest(".sr-only") || !node.textContent?.trim()) continue;
      if (!/(hidden|clip)/.test(style.overflowX + style.overflowY) && style.textOverflow !== "ellipsis") continue;
      if (node.scrollHeight - node.clientHeight > 2 || node.scrollWidth - node.clientWidth > 2) out.push(`${node.tagName.toLowerCase()}.${node.className}`);
    }
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) out.push(`document overflow ${root.scrollWidth}>${root.clientWidth}`);
    return out;
  });
  await page.evaluate(() => document.getElementById("a11y-spacing")?.remove());
  count("text spacing checks");
  if (clipped.length) fail(`text spacing @ ${label}: ${clipped.join(", ")}`);
}

async function checkState(page: Page, label: string, setting: string, kind: Kind): Promise<void> {
  await axe(page, label, setting, kind);
  await textSpacing(page, `${label} 1280`);
  for (const size of [{ width: 320, height: 640 }, { width: 320, height: 256 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(80);
    await reflow(page, `${label} ${size.width}x${size.height}`);
    if (size.height === 640) await textSpacing(page, `${label} 320`);
  }
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(60);
}

// ---------- focus ----------
const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: number[], b: number[]) => { const la = lum(a[0]!, a[1]!, a[2]!); const lb = lum(b[0]!, b[1]!, b[2]!); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

type FocusInfo = { key: string; rect: { x: number; y: number; w: number; h: number }; visiblePoints: number; coveredBySticky: number } | null;
async function focusInfo(page: Page): Promise<FocusInfo> {
  return await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return null;
    const rect = active.getBoundingClientRect();
    const points = [[rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.left + 2, rect.top + 2], [rect.right - 2, rect.top + 2], [rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2]];
    const stickyAncestor = (node: Element | null) => { for (let el = node; el; el = el.parentElement) { const position = getComputedStyle(el).position; if (position === "fixed" || position === "sticky") return el; } return null; };
    let visiblePoints = 0; let coveredBySticky = 0;
    for (const [x, y] of points) {
      if (x! < 0 || y! < 0 || x! >= innerWidth || y! >= innerHeight) continue;
      const hit = document.elementFromPoint(x!, y!);
      if (!hit || hit === active || active.contains(hit) || hit.contains(active)) { visiblePoints += 1; continue; }
      const sticky = stickyAncestor(hit);
      if (sticky && !sticky.contains(active)) coveredBySticky += 1; else visiblePoints += 1;
    }
    const name = (active.getAttribute("aria-label") ?? active.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return { key: `${active.tagName.toLowerCase()}#${active.id}|${name}|${active.getAttribute("href") ?? ""}|${(active as HTMLInputElement).value ?? ""}`, rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }, visiblePoints, coveredBySticky };
  });
}

/** WebKit can finish scrolling a newly focused element after the key event; wait for a stable position. */
async function settledFocus(page: Page): Promise<FocusInfo> {
  let previous = await focusInfo(page);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(30);
    const next = await focusInfo(page);
    if (JSON.stringify(next) === JSON.stringify(previous)) return next;
    previous = next;
  }
  return previous;
}

async function indicator(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<{ px3: number; perimeter: number } | null> {
  const viewport = page.viewportSize()!;
  const x = Math.max(0, rect.x - 8); const y = Math.max(0, rect.y - 8);
  const width = Math.min(viewport.width - x, rect.w + 16); const height = Math.min(viewport.height - y, rect.h + 16);
  if (width < 4 || height < 4) return null;
  const focused = PNG.sync.read(await page.screenshot({ clip: { x, y, width, height }, animations: "disabled", caret: "hide" }));
  await page.evaluate(() => { (window as unknown as { __refocus: Element | null }).__refocus = document.activeElement; (document.activeElement as HTMLElement | null)?.blur(); });
  const plain = PNG.sync.read(await page.screenshot({ clip: { x, y, width, height }, animations: "disabled", caret: "hide" }));
  await page.evaluate(() => { ((window as unknown as { __refocus: HTMLElement | null }).__refocus)?.focus(); });
  let px3 = 0;
  for (let index = 0; index < focused.data.length; index += 4) {
    const a = [focused.data[index]!, focused.data[index + 1]!, focused.data[index + 2]!];
    const b = [plain.data[index]!, plain.data[index + 1]!, plain.data[index + 2]!];
    if ((a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) && ratio(a, b) >= 3) px3 += 1;
  }
  const visibleW = Math.min(rect.w, viewport.width - Math.max(0, rect.x)); const visibleH = Math.min(rect.h, viewport.height - Math.max(0, rect.y));
  return { px3, perimeter: Math.max(0, 2 * (visibleW + visibleH)) };
}

async function walk(page: Page, kind: Kind, label: string, options: { measure: boolean; reverse?: boolean }): Promise<string[]> {
  const key = kind === "webkit" ? (options.reverse ? "Alt+Shift+Tab" : "Alt+Tab") : (options.reverse ? "Shift+Tab" : "Tab");
  const seen: string[] = []; let first: string | null = null; let blanks = 0;
  for (let step = 0; step < 90; step += 1) {
    await page.keyboard.press(key);
    const info = await settledFocus(page);
    if (!info) { blanks += 1; if (blanks > 1) break; continue; }
    if (info.key === first) break;
    first ??= info.key;
    seen.push(info.key);
    count("focus stops");
    if (info.visiblePoints === 0) fail(`focus obscured @ ${label}: ${info.key} (${info.coveredBySticky} points under sticky content)`);
    if (options.measure) {
      const measured = await indicator(page, info.rect);
      if (measured && measured.px3 < Math.min(measured.perimeter, 400)) fail(`focus indicator @ ${label}: ${info.key} has ${measured.px3} px at 3:1 (needs ${Math.min(measured.perimeter, 400)})`);
    }
  }
  return seen;
}

// ---------- suites ----------
async function matrix(browser: Browser, kind: Kind, base: string): Promise<void> {
  for (const setting of SETTINGS) {
    if (setting.chromiumOnly && kind !== "chromium") continue;
    if (ONLY && !ONLY.includes(setting.name)) continue;
    for (const route of ROUTES) {
      const states = route.path === "/" ? DESK_STATES : STATIC_STATES;
      for (const [stateName, enter] of Object.entries(states)) {
        const label = `${kind}/${setting.name}${route.path}#${stateName}`;
        const context = await newContext(browser, kind, setting);
        const page = await context.newPage();
        try {
          await load(page, base, route.path);
          const attributes = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, contrast: document.documentElement.dataset.contrast === "more", motion: document.documentElement.dataset.motion === "reduce", backgrounds: document.documentElement.dataset.backgrounds === "solid" }));
          check(attributes.theme === setting.expect.theme && attributes.contrast === Boolean(setting.expect.contrast) && attributes.motion === Boolean(setting.expect.motion) && attributes.backgrounds === Boolean(setting.expect.backgrounds), `setting not applied @ ${label}: ${JSON.stringify(attributes)}`);
          await enter(page);
          await checkState(page, label, setting.name, kind);
          if (WALK_SETTINGS.has(setting.name) && ["home", "detail-indexed", "compare-supported", "display-open", "default"].includes(stateName)) {
            if (stateName !== "home" && stateName !== "default") await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await walk(page, kind, `${label} walk`, { measure: true });
          }
        } catch (error) {
          fail(`state error @ ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        } finally {
          await context.close();
        }
      }
    }
  }
}

async function obscured(browser: Browser, kind: Kind, base: string): Promise<void> {
  const setting = SETTINGS[0]!;
  for (const viewport of [DESKTOP, { width: 320, height: 256 }]) {
    for (const route of ROUTES) {
      for (const stateName of route.path === "/" ? ["home", "detail-indexed", "display-open"] : ["default", "display-open"]) {
        const context = await newContext(browser, kind, setting, viewport);
        const page = await context.newPage();
        const label = `${kind}${route.path}#${stateName} ${viewport.width}x${viewport.height}`;
        try {
          await load(page, base, route.path);
          await (route.path === "/" ? DESK_STATES : STATIC_STATES)[stateName]!(page);
          if (stateName === "detail-indexed") await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          const forward = await walk(page, kind, `${label} forward`, { measure: false });
          await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, document.documentElement.scrollHeight); });
          await walk(page, kind, `${label} backward`, { measure: false, reverse: true });
          check(forward.length > 3, `keyboard walk found only ${forward.length} stops @ ${label}`);
          if (stateName === "display-open") check(forward.some((key) => key.startsWith("input#panel-appearance")), `Display panel radios not reachable by keyboard @ ${label}`);
        } catch (error) {
          fail(`walk error @ ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
        } finally {
          await context.close();
        }
      }
    }
  }
}

async function structure(browser: Browser, kind: Kind, base: string): Promise<void> {
  const titles = new Set<string>();
  for (const route of ROUTES) {
    const context = await newContext(browser, kind, SETTINGS[0]!);
    const page = await context.newPage();
    const label = `${kind}${route.path}`;
    let status = 0;
    try { status = await load(page, base, route.path); }
    catch (error) { fail(`structure load failed @ ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); await context.close(); continue; }
    check(status === route.status, `status ${status} (expected ${route.status}) @ ${label}`);
    const info = await page.evaluate(() => ({
      title: document.title, lang: document.documentElement.lang, h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main").length,
      banner: [...document.querySelectorAll("header")].filter((node) => !node.closest("main, article, aside, nav, section")).length,
      contentinfo: [...document.querySelectorAll("footer")].filter((node) => !node.closest("main, article, aside, nav, section")).length,
      footerLinks: [...document.querySelectorAll("footer nav a")].map((node) => node.getAttribute("href")),
      sections: [...document.querySelectorAll("main h2[id]")].map((node) => node.id)
    }));
    check(info.title === route.title, `title "${info.title}" @ ${label}`);
    check(!titles.has(info.title), `duplicate title @ ${label}`); titles.add(info.title);
    check(info.lang === "en", `lang @ ${label}`);
    check(info.h1 === 1, `${info.h1} h1 elements @ ${label}`);
    check(info.main === 1 && info.banner === 1 && info.contentinfo === 1, `landmarks main/banner/contentinfo = ${info.main}/${info.banner}/${info.contentinfo} @ ${label}`);
    check(info.footerLinks[0] === "/accessibility/" && info.footerLinks[1] === "/support/", `footer help links out of place @ ${label}: ${info.footerLinks.join(",")}`);
    if (route.name === "accessibility") {
      const required = ["commitment", "standards", "status", "features", "display-settings", "testing", "environments", "limitations", "feedback", "reviewed"];
      check(JSON.stringify(info.sections) === JSON.stringify(required), `accessibility page sections out of order: ${info.sections.join(",")}`);
      check(await page.locator("[data-display-settings-inline] input[type=radio]").count() === 9, `inline Display settings missing @ ${label}`);
    }
    // Skip link: first stop, and it moves focus to <main>.
    await page.keyboard.press(kind === "webkit" ? "Alt+Tab" : "Tab");
    check(await page.evaluate(() => document.activeElement?.classList.contains("skip-link")), `skip link is not the first stop @ ${label}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    check(await page.evaluate(() => document.activeElement?.id === "main"), `skip link does not move focus to main @ ${label}`);
    await context.close();
  }

  // Content-Security-Policy stays strict and the hashed pre-paint script runs (no bypass here).
  for (const route of ROUTES) {
    const context = await browser.newContext({ viewport: DESKTOP, ignoreHTTPSErrors: localTLS });
    await installFixtures(context);
    await context.addInitScript(() => { (window as unknown as { __csp: string[] }).__csp = []; document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`)); });
    const page = await context.newPage();
    await page.goto(base + route.path, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => ({ csp: (window as unknown as { __csp: string[] }).__csp, theme: document.documentElement.dataset.theme, js: document.documentElement.classList.contains("js") }));
    check(result.csp.length === 0, `CSP violations @ ${kind}${route.path}: ${result.csp.join("; ")}`);
    check(Boolean(result.theme) && result.js, `pre-paint script did not run under CSP @ ${kind}${route.path}`);
    await context.close();
  }
}

async function http(base: string): Promise<void> {
  const redirect = await fetch(`${base}/accessibility`, { redirect: "manual" });
  check([301, 307, 308].includes(redirect.status) && (redirect.headers.get("location") ?? "").endsWith("/accessibility/"), `/accessibility does not redirect to /accessibility/ (${redirect.status})`);
  const security = await fetch(`${base}/.well-known/security.txt`);
  const body = await security.text();
  check(security.status === 200 && (security.headers.get("content-type") ?? "").startsWith("text/plain"), `security.txt not served as text/plain (${security.status})`);
  check(/^Contact: mailto:support@vicerobotics\.com$/m.test(body) && /^Policy: https:\/\/\S+$/m.test(body), "security.txt Contact/Policy missing");
  const expires = Date.parse(/^Expires: (\S+)$/m.exec(body)?.[1] ?? "");
  check(expires > Date.now() && expires - Date.now() < 365 * 86_400_000, "security.txt Expires must be in the future and less than a year out");
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  check(sitemap.includes("/accessibility/") && sitemap.includes("/support/"), "sitemap is missing the accessibility or support page");
  const missing = await fetch(`${base}/no-such-page-a11y/`, { headers: { accept: "text/html", "sec-fetch-mode": "navigate" } });
  check(missing.status === 404 && (await missing.text()).includes("Page not found"), `unknown URL returned ${missing.status} without the not-found page`);
  const home = await fetch(`${base}/`);
  const csp = home.headers.get("content-security-policy") ?? "";
  check(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/.test(csp) && !csp.includes("unsafe-inline"), `CSP script-src unexpected: ${csp}`);
}

async function displaySettings(browser: Browser, kind: Kind, base: string): Promise<void> {
  const TAB = kind === "webkit" ? "Alt+Tab" : "Tab";
  const label = (name: string) => `${kind} display: ${name}`;

  // JavaScript off: System behavior still follows the device.
  for (const [scheme, contrast, motion, expected] of [["dark", "no-preference", "no-preference", { bg: "rgb(7, 24, 43)" }], ["light", "no-preference", "no-preference", { bg: "rgb(247, 244, 237)" }], ["dark", "more", "no-preference", { muted: "#d3dbe6" }], ["light", "no-preference", "reduce", { dur: "0s" }]] as const) {
    const context = await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: false, colorScheme: scheme, contrast, reducedMotion: motion, ignoreHTTPSErrors: localTLS });
    const page = await context.newPage();
    await page.goto(`${base}/accessibility/`);
    const value = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, muted: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(), dur: getComputedStyle(document.documentElement).getPropertyValue("--dur").trim().replace(/^0ms$/, "0s"), display: getComputedStyle(document.querySelector(".display-control")!).display }));
    for (const [key, want] of Object.entries(expected)) check(value[key as keyof typeof value] === want, label(`JS off ${scheme}/${contrast}/${motion} ${key}=${value[key as keyof typeof value]} want ${want}`));
    check(value.display === "none", label("Display button shown without JavaScript"));
    await context.close();
  }

  // Pre-paint: a stored choice applies before the body is parsed.
  {
    const context = await newContext(browser, kind, { ...SETTINGS[0]!, storage: { theme: "dark", a11y: { contrast: "more" } } });
    await context.addInitScript(() => {
      new MutationObserver((_, observer) => { if (document.body) { (window as unknown as { __atBody: string }).__atBody = `${document.documentElement.dataset.theme}/${document.documentElement.dataset.contrast}`; observer.disconnect(); } }).observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();
    await page.goto(`${base}/support/`);
    const atBody = await page.evaluate(() => (window as unknown as { __atBody: string }).__atBody);
    check(atBody === "dark/more", label(`stored choice not applied before first paint (${atBody})`));
    await context.close();
  }

  // Blocked storage: an explicit choice survives a device change, and Reset still works and announces once.
  {
    const context = await newContext(browser, kind, SETTINGS[0]!);
    await context.addInitScript(() => {
      const thrower = { get() { throw new DOMException("The operation is insecure.", "SecurityError"); }, configurable: true };
      Object.defineProperty(window, "localStorage", thrower);
      Object.defineProperty(window, "sessionStorage", thrower);
    });
    const page = await context.newPage();
    await page.goto(`${base}/support/`);
    await page.click("#display-toggle");
    await page.click("#panel-appearance-dark");
    await page.click("#panel-contrast-more");
    await page.emulateMedia({ colorScheme: "dark" }); await page.emulateMedia({ colorScheme: "light", contrast: "no-preference" });
    await page.waitForTimeout(100);
    check(await page.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.contrast === "more"), label("explicit choice lost after a device change with storage blocked"));
    await page.evaluate(() => {
      (window as unknown as { __announcements: string[] }).__announcements = [];
      new MutationObserver(() => {
        for (const region of document.querySelectorAll("[role=status], [role=alert], [aria-live]")) if (region.textContent?.includes("Display settings reset")) (window as unknown as { __announcements: string[] }).__announcements.push(region.id || region.className);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.click("text=Reset display settings");
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, contrast: document.documentElement.dataset.contrast ?? null, announcements: (window as unknown as { __announcements: string[] }).__announcements, checked: (document.querySelector("#panel-appearance-auto") as HTMLInputElement).checked }));
    check(after.theme === "light" && after.contrast === null && after.checked, label(`Reset with blocked storage: ${JSON.stringify(after)}`));
    check(after.announcements.length === 1, label(`Reset announced ${after.announcements.length} times`));
    await context.close();
  }

  // Keyboard: Enter/Space open, arrows move radios, Escape returns focus, focus leaving closes, click outside closes.
  {
    const context = await newContext(browser, kind, SETTINGS[0]!);
    const page = await context.newPage();
    await page.goto(`${base}/support/`);
    await page.focus("#display-toggle");
    await page.keyboard.press("Enter");
    check(await page.getAttribute("#display-toggle", "aria-expanded") === "true" && await page.isVisible("#display-panel"), label("Enter does not open the panel"));
    await page.keyboard.press(TAB);
    check(await page.evaluate(() => document.activeElement?.id === "panel-appearance-auto"), label("Tab does not move into the panel"));
    await page.keyboard.press("ArrowDown");
    check(await page.evaluate(() => document.activeElement?.id === "panel-appearance-light" && document.documentElement.dataset.theme === "light" && (document.activeElement as HTMLInputElement).checked), label("ArrowDown does not select Light"));
    await page.keyboard.press("ArrowDown");
    check(await page.evaluate(() => document.documentElement.dataset.theme === "dark"), label("ArrowDown does not select Dark"));
    await page.keyboard.press("Escape");
    check(await page.evaluate(() => document.activeElement?.id === "display-toggle") && !(await page.isVisible("#display-panel")), label("Escape does not close and return focus"));
    await page.keyboard.press("Space");
    check(await page.isVisible("#display-panel"), label("Space does not open the panel"));
    await page.keyboard.press(kind === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
    await page.waitForTimeout(50);
    check(!(await page.isVisible("#display-panel")), label("focus leaving does not close the panel"));
    await page.click("#display-toggle");
    await page.mouse.click(40, 400);
    check(!(await page.isVisible("#display-panel")), label("click outside does not close the panel"));
    // Accessibility tree: legends name the groups and each radio's name is its visible text.
    await page.click("#display-toggle");
    for (const [group, options] of [["Appearance", ["System", "Light", "Dark"]], ["Contrast", ["System", "More"]], ["Motion", ["System", "Reduce"]], ["Backgrounds", ["System", "Solid"]]] as const) {
      const fieldset = page.locator("#display-panel").getByRole("group", { name: group, exact: true });
      check(await fieldset.count() === 1, label(`group "${group}" not exposed`));
      for (const option of options) check(await fieldset.getByRole("radio", { name: option, exact: true }).count() === 1, label(`radio "${option}" in ${group} not named by its visible text`));
    }
    check(await page.getByRole("button", { name: "Display", exact: true }).count() === 1, label("Display button name does not match its visible text"));
    await context.close();
  }

  // Other tabs stay in sync through the storage event, and storage holds only explicit display choices.
  {
    const context = await newContext(browser, kind, SETTINGS[0]!);
    const desk = await context.newPage();
    const other = await context.newPage();
    await load(desk, base, "/");
    await other.goto(`${base}/support/`);
    await typeQuery(desk, "reenlistment bonus 3044");
    await desk.fill("#eligibility-rank", "E-5"); await desk.fill("#eligibility-mos", "3044"); await desk.fill("#eligibility-zone", "B"); await desk.fill("#eligibility-years-of-service", "6");
    await desk.selectOption("#eligibility-component", "reserve");
    await desk.click("#display-toggle");
    await desk.click("#panel-appearance-dark"); await desk.click("#panel-motion-reduce"); await desk.click("#panel-backgrounds-solid");
    await other.waitForTimeout(300);
    check(await other.evaluate(() => document.documentElement.dataset.theme === "dark" && document.documentElement.dataset.motion === "reduce"), label("other tab did not follow the change"));
    const stored = await desk.evaluate(() => ({ local: Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])), session: sessionStorage.length, cookie: document.cookie }));
    const keys = Object.keys(stored.local).sort();
    const a11y = (() => { try { return JSON.parse(stored.local["vice.a11y.v1"] ?? "null") as unknown; } catch { return null; } })();
    check(JSON.stringify(keys) === JSON.stringify(["vice.a11y.v1", "vice.theme"]) && stored.local["vice.theme"] === "dark" && JSON.stringify(a11y) === JSON.stringify({ motion: "reduce", backgrounds: "solid" }), label(`unexpected storage ${JSON.stringify(stored.local)}`));
    check(!JSON.stringify(stored.local).match(/3044|E-5|reenlistment|reserve/i) && stored.session === 0 && stored.cookie === "", label("storage contains query or profile input"));
    await context.close();
  }
}

async function journeys(browser: Browser, kind: Kind, base: string): Promise<void> {
  const TAB = kind === "webkit" ? "Alt+Tab" : "Tab";
  for (const viewport of [DESKTOP, { width: 320, height: 640 }]) {
    const label = (name: string) => `${kind} ${viewport.width}px: ${name}`;
    const context = await newContext(browser, kind, SETTINGS[0]!, viewport);
    const page = await context.newPage();
    await load(page, base, "/");
    // Statuses: one short announcement per completed search; the list is not a live region.
    await page.evaluate(() => {
      const status = document.getElementById("search-status")!;
      (window as unknown as { __status: string[] }).__status = [];
      new MutationObserver(() => { if (status.textContent) (window as unknown as { __status: string[] }).__status.push(status.textContent); }).observe(status, { subtree: true, childList: true, characterData: true });
    });
    await page.focus("#maradmin-search");
    await page.keyboard.type("reenlistment bonus", { delay: 40 });
    await waitIdle(page); await page.waitForTimeout(400);
    const statuses = await page.evaluate(() => (window as unknown as { __status: string[] }).__status);
    check(statuses.length === 1 && statuses[0] === "20 results for “reenlistment bonus”.", label(`search status announced ${statuses.length} times: ${statuses.join(" | ")}`));
    check(await page.evaluate(() => !document.querySelector(".results")?.closest("[aria-live], [role=status], [role=alert]") && !document.querySelector(".results [aria-live]")), label("result list is inside a live region"));

    // F08: an explicit Open moves focus to the detail heading, which is visible, and Back returns to the result.
    await page.focus(`#result-${RESULTS[1]!.id}`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "evidence-heading");
    const heading = await settledFocus(page);
    check(heading && heading.visiblePoints >= 3 && heading.rect.y >= 0 && heading.rect.y < viewport.height, label(`evidence heading not visible after Open: ${JSON.stringify(heading)}`));
    check(await page.evaluate(() => document.activeElement?.textContent) === `MARADMIN ${RESULTS[1]!.number}`, label("evidence heading does not name the opened message"));
    check(await page.getAttribute(`#result-${RESULTS[1]!.id}`, "aria-current") === "true", label("opened result is not marked current"));
    await page.keyboard.press(TAB);
    check(await page.evaluate(() => document.activeElement?.closest(".research-panel") !== null), label("Tab after Open leaves the evidence desk"));
    await page.locator("button", { hasText: "Back to result list" }).focus();
    await page.keyboard.press("Enter");
    check(await page.evaluate((id) => document.activeElement?.id === `result-${id}`, RESULTS[1]!.id), label("Back to result list does not return to the opened result"));

    // Comparison: invalid fields get focus and described errors; a completed comparison moves focus to its result.
    await page.focus(`#compare-${RESULTS[0]!.id}`); await page.keyboard.press("Space");
    await page.focus(`#compare-${RESULTS[2]!.id}`); await page.keyboard.press("Space");
    await page.focus("#eligibility-rank"); await page.keyboard.type("E5");
    await page.evaluate(() => {
      (window as unknown as { __focusState: string[] }).__focusState = [];
      document.addEventListener("focusin", (event) => { const target = event.target as HTMLElement; (window as unknown as { __focusState: string[] }).__focusState.push(`${target.id}:${target.getAttribute("aria-invalid")}`); });
      document.getElementById("eligibility-rank")?.blur();
    });
    await page.focus(".assess"); await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const focusState = await page.evaluate(() => (window as unknown as { __focusState: string[] }).__focusState);
    check(focusState.at(-1) === "eligibility-rank:true", label(`invalid field not marked invalid when focused: ${focusState.join(", ")}`));
    const invalid = await page.evaluate(() => { const field = document.activeElement as HTMLInputElement; return { id: field.id, invalid: field.getAttribute("aria-invalid"), described: (field.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent).join(" ") }; });
    check(invalid.id === "eligibility-rank" && invalid.invalid === "true" && invalid.described.includes("Use E-1"), label(`invalid field handling ${JSON.stringify(invalid)}`));
    await page.fill("#eligibility-rank", "E-5"); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "assessment-heading");
    const result = await settledFocus(page);
    check(result && result.visiblePoints >= 3, label(`comparison result heading not visible ${JSON.stringify(result)}`));
    check(await page.evaluate(() => document.activeElement?.textContent) === "Supported by indexed evidence", label("comparison result heading text"));
    await page.locator("button", { hasText: "Clear selection" }).focus();
    await page.keyboard.press("Enter");
    check(await page.evaluate(() => document.activeElement?.classList.contains("assess") && document.querySelectorAll(".compare input:checked").length === 0), label("Clear selection does not clear or loses focus"));
    await context.close();

    // Nothing selected: the error is announced by an alert and focus stays on the button.
    const context2 = await newContext(browser, kind, SETTINGS[0]!, viewport);
    const page2 = await context2.newPage();
    await load(page2, base, "/");
    await page2.focus(".assess"); await page2.keyboard.press("Enter");
    await page2.waitForTimeout(150);
    check(await page2.evaluate(() => document.activeElement?.classList.contains("assess") && document.querySelector("[role=alert] .compare-error")?.textContent?.includes("Select at least one")), label("no-selection error not announced near the Compare button"));
    await context2.close();
  }
}

/** A header that wraps (medium width, larger text) must still be cleared when focus moves or tabs past it. */
async function wrappedHeader(browser: Browser, kind: Kind, base: string): Promise<void> {
  const viewport = { width: 700, height: 600 };
  const context = await newContext(browser, kind, SETTINGS[0]!, viewport);
  const page = await context.newPage();
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = "html{font-size:150% !important}"; document.head.appendChild(style); }));
  await load(page, base, "/");
  const label = `${kind} 700px at 150% text`;
  const header = await page.evaluate(() => ({ height: document.querySelector(".topbar")!.getBoundingClientRect().height, sticky: getComputedStyle(document.querySelector(".topbar")!).position }));
  check(header.sticky !== "sticky" || header.height > 72, `${label}: expected a wrapped header for this check (${JSON.stringify(header)})`);
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.focus(`#result-${RESULTS[4]!.id}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.id === "evidence-heading");
  const heading = await settledFocus(page);
  check(heading && heading.coveredBySticky === 0 && heading.visiblePoints === 5, `${label}: evidence heading under the header ${JSON.stringify(heading)}`);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await walk(page, kind, `${label} walk`, { measure: false });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await walk(page, kind, `${label} reverse walk`, { measure: false, reverse: true });
  await context.close();
}

async function tokenContrast(browser: Browser): Promise<void> {
  const pairs = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "token-pairs.json"), "utf8")) as { pairs: Array<{ fg: string; bg: string; under?: string; kind: "text" | "ui"; use: string }> }).pairs;
  const context = await browser.newContext({ viewport: DESKTOP, colorScheme: "light", ignoreHTTPSErrors: localTLS });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  for (const theme of ["light", "dark"]) {
    for (const contrast of [false, true]) {
      const results = await page.evaluate(({ theme, contrast, pairs }) => {
        const root = document.documentElement;
        root.dataset.theme = theme;
        if (contrast) root.dataset.contrast = "more"; else delete root.dataset.contrast;
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        const parse = (value: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = "#000"; context.fillStyle = value; context.fillRect(0, 0, 1, 1); const data = context.getImageData(0, 0, 1, 1).data; return [data[0]!, data[1]!, data[2]!, data[3]! / 255]; };
        const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
        const blend = (top: number[], bottom: number[]) => top.slice(0, 3).map((channel, index) => channel * top[3]! + bottom[index]! * (1 - top[3]!));
        const lum = (rgb: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!); };
        return pairs.map((pair) => {
          const under = parse(read(pair.under ?? "--bg"));
          const bg = blend(parse(read(pair.bg)), under);
          const fg = blend(parse(read(pair.fg)), bg);
          const [light, dark] = [lum(fg), lum(bg)].sort((a, b) => b - a);
          return { ...pair, fgValue: read(pair.fg), bgValue: read(pair.bg), ratio: Math.round(((light! + 0.05) / (dark! + 0.05)) * 100) / 100 };
        });
      }, { theme, contrast, pairs });
      for (const result of results) {
        const need = result.kind === "text" ? (contrast ? 7 : 4.5) : (contrast ? 4.5 : 3);
        count("token pairs");
        if (result.ratio < need) fail(`token contrast ${theme}${contrast ? "+more" : ""}: ${result.fg} ${result.fgValue} on ${result.bg} ${result.bgValue} = ${result.ratio} (needs ${need}; ${result.use})`);
      }
    }
  }
  await context.close();
}

// ---------- main ----------
let baseURL = "";
async function main(): Promise<void> {
  const started = Date.now();
  const server = await startServer();
  baseURL = server.base;
  try {
    try { await http(server.base); } catch (error) { fail(`HTTP checks stopped: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
    const browsers: Array<[Kind, Browser]> = [["chromium", await chromium.launch()], ["webkit", await webkit.launch()]];
    try {
      try { await tokenContrast(browsers[0]![1]); } catch (error) { fail(`token contrast suite stopped: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
      await Promise.all(browsers.map(async ([kind, browser]) => {
        // A suite that throws is a failure, but the remaining suites still run and report.
        for (const [name, suite] of [["structure", structure], ["display settings", displaySettings], ["journeys", journeys], ["focus not obscured", obscured], ["wrapped header", wrappedHeader], ["matrix", matrix]] as const) {
          try { await suite(browser, kind, server.base); }
          catch (error) { fail(`${kind} ${name} suite stopped: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
        }
      }));
      summary.browsers = browsers.length;
      (summary as Record<string, unknown>).versions = Object.fromEntries(browsers.map(([kind, browser]) => [kind, browser.version()])) as unknown as number;
    } finally {
      await Promise.all(browsers.map(([, browser]) => browser.close()));
    }
  } finally {
    server.stop();
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = { base: server.base, date: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), summary, failures, incomplete: [...incomplete.values()].map((item) => ({ rule: item.rule, target: item.target, states: item.states.size, example: [...item.states][0] })) };
  fs.writeFileSync(path.join(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Accessibility gate: ${JSON.stringify(summary)} in ${report.seconds}s`);
  console.log(`axe needs-review items (see .project-local/a11y/report.json): ${report.incomplete.map((item) => `${item.rule} ${item.target} ×${item.states}`).join("; ") || "none"}`);
  if (failures.length) {
    console.error(`\n${failures.length} accessibility failure(s):`);
    for (const message of failures.slice(0, 200)) console.error(`  ✗ ${message}`);
    process.exit(1);
  }
  console.log("Accessibility gate passed.");
}

await main();

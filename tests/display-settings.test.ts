import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resultCountMessage, searchErrorFor } from "../src/search-feedback";
import { injectChrome } from "../src/chrome/partials";
import { PREPAINT_CSP_HASH, PREPAINT_SOURCE } from "../src/chrome/prepaint";
import { A11Y_KEY, DisplaySettings, THEME_KEY, parseChoices, resolve, serializeA11y } from "../src/display/settings";

type MediaFlags = { dark: boolean; contrastMore: boolean; reduceMotion: boolean; reduceTransparency: boolean };

function fakeWindow(options: { storage?: "ok" | "throws"; media?: Partial<MediaFlags> } = {}) {
  const store = new Map<string, string>();
  const attributes = new Map<string, string>();
  const media: Record<string, { matches: boolean; listeners: Array<() => void> }> = {
    "(prefers-color-scheme: dark)": { matches: Boolean(options.media?.dark), listeners: [] },
    "(prefers-contrast: more)": { matches: Boolean(options.media?.contrastMore), listeners: [] },
    "(prefers-reduced-motion: reduce)": { matches: Boolean(options.media?.reduceMotion), listeners: [] },
    "(prefers-reduced-transparency: reduce)": { matches: Boolean(options.media?.reduceTransparency), listeners: [] }
  };
  const blocked = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
  const localStorage = options.storage === "throws"
    ? { getItem: blocked, setItem: blocked, removeItem: blocked }
    : { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
  const win = {
    localStorage,
    matchMedia: (query: string) => ({ get matches() { return media[query]!.matches; }, addEventListener: (_: string, listener: () => void) => media[query]!.listeners.push(listener) }),
    addEventListener: () => undefined,
    setTimeout: (callback: () => void) => { callback(); return 0; },
    document: {
      documentElement: { setAttribute: (name: string, value: string) => void attributes.set(name, value), removeAttribute: (name: string) => void attributes.delete(name) },
      body: { appendChild: () => undefined },
      createElement: () => ({ setAttribute: () => undefined, textContent: "" })
    }
  };
  const change = (query: keyof typeof media, matches: boolean) => { media[query]!.matches = matches; for (const listener of media[query]!.listeners) listener(); };
  return { win: win as unknown as Window, store, attributes, change };
}

describe("Display settings", () => {
  it("allows the inlined pre-paint script by its exact CSP hash", () => {
    const digest = `sha256-${createHash("sha256").update(PREPAINT_SOURCE, "utf8").digest("base64")}`;
    expect(PREPAINT_CSP_HASH).toBe(digest);
    expect(readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8")).toContain("PREPAINT_CSP_HASH");
  });

  it("injects the shared chrome into every page and rejects unresolved placeholders", () => {
    for (const page of ["../index.html", "../accessibility/index.html", "../support/index.html", "../404.html"]) {
      const html = injectChrome(readFileSync(new URL(page, import.meta.url), "utf8"));
      expect(html).toContain(`<script>${PREPAINT_SOURCE}</script>`);
      expect(html).toContain('href="/accessibility/"');
      expect(html).toContain('id="display-toggle"');
    }
    expect(() => injectChrome("<!--chrome:unknown-->")).toThrow("Unresolved chrome placeholder");
  });

  it("validates stored values and ignores anything unknown", () => {
    expect(parseChoices("dark", '{"contrast":"more","motion":"reduce","backgrounds":"solid"}')).toEqual({ appearance: "dark", contrast: true, motion: true, backgrounds: true });
    expect(parseChoices("sepia", '{"contrast":"less","query":"reenlistment"}')).toEqual({ appearance: "auto", contrast: false, motion: false, backgrounds: false });
    expect(parseChoices(null, "not json")).toEqual({ appearance: "auto", contrast: false, motion: false, backgrounds: false });
  });

  it("stores only explicit choices", () => {
    expect(serializeA11y({ appearance: "dark", contrast: false, motion: true, backgrounds: false })).toBe('{"motion":"reduce"}');
    expect(serializeA11y({ appearance: "auto", contrast: false, motion: false, backgrounds: false })).toBeNull();
  });

  it("never lets a manual choice remove a device request", () => {
    const resolved = resolve({ appearance: "light", contrast: false, motion: false, backgrounds: false }, { dark: true, contrastMore: true, reduceMotion: true, reduceTransparency: true });
    expect(resolved).toEqual({ theme: "light", contrast: true, motion: true, backgrounds: true });
  });

  it("keeps an explicit choice through a device change when storage is blocked, and Reset returns to System", () => {
    const { win, attributes, change } = fakeWindow({ storage: "throws" });
    const settings = new DisplaySettings(win);
    expect(attributes.get("data-theme")).toBe("light");
    settings.set("appearance", "dark");
    settings.set("contrast", true);
    change("(prefers-color-scheme: dark)", true);
    change("(prefers-color-scheme: dark)", false);
    expect(attributes.get("data-theme")).toBe("dark");
    expect(attributes.get("data-contrast")).toBe("more");
    settings.reset();
    expect(attributes.get("data-theme")).toBe("light");
    expect(attributes.has("data-contrast")).toBe(false);
  });

  it("writes only the two display keys", () => {
    const { win, store } = fakeWindow();
    const settings = new DisplaySettings(win);
    settings.set("appearance", "dark");
    settings.set("backgrounds", true);
    expect(Object.fromEntries(store)).toEqual({ [THEME_KEY]: "dark", [A11Y_KEY]: '{"backgrounds":"solid"}' });
    settings.reset();
    expect(store.size).toBe(0);
  });
});

describe("search feedback", () => {
  it("explains how to fix an unsupported query instead of reporting an outage", () => {
    expect(searchErrorFor("message_centric_query_required")).toEqual({ message: expect.stringContaining("Add a MARADMIN number, MOS, or policy topic"), queryProblem: true });
    expect(searchErrorFor("people_search_not_supported").queryProblem).toBe(true);
    expect(searchErrorFor("rate_limited").message).toContain("Wait a minute");
    expect(searchErrorFor("internal_error").message).toContain("temporarily unavailable");
  });

  it("summarizes a completed search in one short status", () => {
    expect(resultCountMessage(20, "reenlistment bonus")).toBe("20 results for “reenlistment bonus”.");
    expect(resultCountMessage(1, "3044")).toBe("1 result for “3044”.");
    expect(resultCountMessage(0, "zzz policy")).toBe("No results for “zzz policy”.");
    expect(resultCountMessage(20, "")).toBe("20 latest MARADMINs shown.");
  });
});

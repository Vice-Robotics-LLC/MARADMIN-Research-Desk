// Display & accessibility settings (Vice Robotics DISPLAY_CONTROLS spec).
//
// Storage holds only explicit display choices: `vice.theme` (auto | light | dark) and `vice.a11y.v1`
// ({"contrast":"more","motion":"reduce","backgrounds":"solid"}, explicit keys only). Queries, rank,
// MOS, component, zone and every other input on the Research Desk are never written here.

export const THEME_KEY = "vice.theme";
export const A11Y_KEY = "vice.a11y.v1";

export type Appearance = "auto" | "light" | "dark";
export type Choices = { appearance: Appearance; contrast: boolean; motion: boolean; backgrounds: boolean };
export type Media = { dark: boolean; contrastMore: boolean; reduceMotion: boolean; reduceTransparency: boolean };
export type Resolved = { theme: "light" | "dark"; contrast: boolean; motion: boolean; backgrounds: boolean };

export const SYSTEM_CHOICES: Choices = { appearance: "auto", contrast: false, motion: false, backgrounds: false };

const QUERIES = {
  dark: "(prefers-color-scheme: dark)",
  contrastMore: "(prefers-contrast: more)",
  reduceMotion: "(prefers-reduced-motion: reduce)",
  reduceTransparency: "(prefers-reduced-transparency: reduce)"
} as const;

/** Validates stored values; anything unknown is ignored and treated as System. */
export function parseChoices(theme: string | null, a11y: string | null): Choices {
  const choices: Choices = { ...SYSTEM_CHOICES };
  if (theme === "light" || theme === "dark" || theme === "auto") choices.appearance = theme;
  if (a11y) {
    try {
      const parsed: unknown = JSON.parse(a11y);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>;
        choices.contrast = value.contrast === "more";
        choices.motion = value.motion === "reduce";
        choices.backgrounds = value.backgrounds === "solid";
      }
    } catch { /* Invalid JSON is ignored. */ }
  }
  return choices;
}

/** Serializes only explicit choices. Returns null when every setting is System. */
export function serializeA11y(choices: Choices): string | null {
  const explicit: Record<string, string> = {};
  if (choices.contrast) explicit.contrast = "more";
  if (choices.motion) explicit.motion = "reduce";
  if (choices.backgrounds) explicit.backgrounds = "solid";
  return Object.keys(explicit).length ? JSON.stringify(explicit) : null;
}

/** A manual choice can only add to what the device asks for; it can never remove a device request. */
export function resolve(choices: Choices, media: Media): Resolved {
  return {
    theme: choices.appearance === "auto" ? (media.dark ? "dark" : "light") : choices.appearance,
    contrast: choices.contrast || media.contrastMore,
    motion: choices.motion || media.reduceMotion,
    backgrounds: choices.backgrounds || media.reduceTransparency
  };
}

export function applyResolved(root: HTMLElement, resolved: Resolved): void {
  root.setAttribute("data-theme", resolved.theme);
  const toggle = (name: string, on: boolean, value: string) => on ? root.setAttribute(name, value) : root.removeAttribute(name);
  toggle("data-contrast", resolved.contrast, "more");
  toggle("data-motion", resolved.motion, "reduce");
  toggle("data-backgrounds", resolved.backgrounds, "solid");
}

type Listener = (choices: Choices) => void;

export class DisplaySettings {
  private choices: Choices;
  private readonly listeners = new Set<Listener>();
  private readonly lists: Partial<Record<keyof Media, MediaQueryList>> = {};
  private announcer: HTMLElement | null = null;

  constructor(private readonly win: Window = window) {
    this.choices = this.readStorage();
    for (const [key, query] of Object.entries(QUERIES) as [keyof Media, string][]) {
      const list = typeof win.matchMedia === "function" ? win.matchMedia(query) : null;
      if (!list) continue;
      this.lists[key] = list;
      // A device change re-resolves from the in-memory choices, so an explicit choice always survives.
      list.addEventListener?.("change", () => this.apply());
    }
    win.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== THEME_KEY && event.key !== A11Y_KEY) return;
      this.choices = this.readStorage();
      this.apply();
      this.emit();
    });
    this.apply();
  }

  get current(): Choices { return { ...this.choices }; }

  media(): Media {
    return {
      dark: Boolean(this.lists.dark?.matches),
      contrastMore: Boolean(this.lists.contrastMore?.matches),
      reduceMotion: Boolean(this.lists.reduceMotion?.matches),
      reduceTransparency: Boolean(this.lists.reduceTransparency?.matches)
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set<Key extends keyof Choices>(key: Key, value: Choices[Key]): void {
    this.choices = { ...this.choices, [key]: value };
    this.persist();
    this.apply();
    this.emit();
  }

  reset(): void {
    this.choices = { ...SYSTEM_CHOICES };
    this.persist();
    this.apply();
    this.emit();
    this.announce("Display settings reset");
  }

  private announce(message: string): void {
    const doc = this.win.document;
    if (!this.announcer) {
      this.announcer = doc.createElement("div");
      this.announcer.className = "sr-only";
      this.announcer.setAttribute("role", "status");
      this.announcer.id = "display-announcer";
      doc.body.appendChild(this.announcer);
    }
    const region = this.announcer;
    region.textContent = "";
    // A fresh text node after a tick lets a repeated Reset be announced again, still exactly once each time.
    this.win.setTimeout(() => { region.textContent = message; }, 50);
  }

  private apply(): void {
    applyResolved(this.win.document.documentElement, resolve(this.choices, this.media()));
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current);
  }

  private readStorage(): Choices {
    try {
      return parseChoices(this.win.localStorage.getItem(THEME_KEY), this.win.localStorage.getItem(A11Y_KEY));
    } catch {
      return this.choices ? { ...this.choices } : { ...SYSTEM_CHOICES };
    }
  }

  private persist(): void {
    try {
      const storage = this.win.localStorage;
      if (this.choices.appearance === "auto") storage.removeItem(THEME_KEY);
      else storage.setItem(THEME_KEY, this.choices.appearance);
      const a11y = serializeA11y(this.choices);
      if (a11y) storage.setItem(A11Y_KEY, a11y);
      else storage.removeItem(A11Y_KEY);
    } catch { /* Storage can be blocked; the in-memory choice still applies for this page. */ }
  }
}

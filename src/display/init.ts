import { initDisplayPanel, initInlineSettings } from "./controls";
import { DisplaySettings } from "./settings";

/** Shared page chrome: every page gets the header Display panel; the accessibility page also gets the inline form. */
export function initDisplay(): DisplaySettings {
  const settings = new DisplaySettings(window);
  trackStickyHeader();
  revealFocusedElements();
  initDisplayPanel(settings);
  initInlineSettings(settings);
  return settings;
}

/** Keeps scroll-padding equal to the real header height, including when its contents wrap at larger text sizes. */
function trackStickyHeader(): void {
  const header = document.querySelector<HTMLElement>(".topbar");
  if (!header || typeof ResizeObserver === "undefined") return;
  const update = () => {
    const sticky = getComputedStyle(header).position === "sticky";
    document.documentElement.style.setProperty("--sticky-offset", sticky ? `${Math.ceil(header.getBoundingClientRect().height)}px` : "0px");
  };
  new ResizeObserver(update).observe(header);
  window.addEventListener("resize", update);
  update();
}

/**
 * Browsers normally scroll a keyboard-focused element into view; some WebKit builds (WebKitGTK/WPE) don't for
 * form fields. Reveal it when it is fully off screen or hidden under the sticky header (WCAG 2.4.11).
 */
function revealFocusedElements(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === document.body) return;
    const rect = target.getBoundingClientRect();
    const covered = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (rect.bottom <= covered || rect.top >= window.innerHeight) target.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

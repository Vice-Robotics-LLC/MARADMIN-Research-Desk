import { initDisplayPanel, initInlineSettings } from "./controls";
import { DisplaySettings } from "./settings";

/** Shared page chrome: every page gets the header Display panel; the accessibility page also gets the inline form. */
export function initDisplay(): DisplaySettings {
  const settings = new DisplaySettings(window);
  initDisplayPanel(settings);
  initInlineSettings(settings);
  return settings;
}

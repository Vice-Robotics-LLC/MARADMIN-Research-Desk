import { DisplaySettings, type Appearance, type Choices } from "./settings";

type Option = { value: string; label: string };
type Group = { key: keyof Choices; legend: string; hint: string; options: Option[] };

const GROUPS: Group[] = [
  { key: "appearance", legend: "Appearance", hint: "System follows your device’s light or dark setting.", options: [{ value: "auto", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
  { key: "contrast", legend: "Contrast", hint: "More raises text and control contrast and underlines every link. System follows your device’s Increase Contrast setting.", options: [{ value: "system", label: "System" }, { value: "more", label: "More" }] },
  { key: "motion", legend: "Motion", hint: "Reduce turns off transitions and smooth scrolling. System follows your device’s Reduce Motion setting.", options: [{ value: "system", label: "System" }, { value: "reduce", label: "Reduce" }] },
  { key: "backgrounds", legend: "Backgrounds", hint: "Solid removes blur, translucency and background images behind text. System follows Reduce Transparency where your browser shares it.", options: [{ value: "system", label: "System" }, { value: "solid", label: "Solid" }] }
];

function valueFor(choices: Choices, key: keyof Choices): string {
  if (key === "appearance") return choices.appearance;
  if (key === "contrast") return choices.contrast ? "more" : "system";
  if (key === "motion") return choices.motion ? "reduce" : "system";
  return choices.backgrounds ? "solid" : "system";
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Renders one set of native radio groups bound to the shared settings. */
export function renderSettingsForm(container: HTMLElement, settings: DisplaySettings, options: { prefix: string; accessibilityLink: boolean }): void {
  const root = element("div", { class: "display-form" });
  const radios: HTMLInputElement[] = [];
  for (const group of GROUPS) {
    const hintID = `${options.prefix}-${group.key}-hint`;
    const fieldset = element("fieldset", { "aria-describedby": hintID });
    fieldset.appendChild(element("legend", {}, group.legend));
    fieldset.appendChild(element("p", { class: "hint", id: hintID }, group.hint));
    const optionList = element("div", { class: "options" });
    for (const option of group.options) {
      const id = `${options.prefix}-${group.key}-${option.value}`;
      const input = element("input", { type: "radio", name: `${options.prefix}-${group.key}`, value: option.value, id });
      input.dataset.setting = group.key;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        if (group.key === "appearance") settings.set("appearance", option.value as Appearance);
        else settings.set(group.key, option.value !== "system");
      });
      radios.push(input);
      const label = element("label", { for: id });
      label.appendChild(input);
      label.appendChild(document.createTextNode(option.label));
      optionList.appendChild(label);
    }
    fieldset.appendChild(optionList);
    root.appendChild(fieldset);
  }
  const actions = element("div", { class: "actions" });
  const reset = element("button", { type: "button", class: "button-secondary" }, "Reset display settings");
  reset.addEventListener("click", () => settings.reset());
  actions.appendChild(reset);
  if (options.accessibilityLink) actions.appendChild(element("a", { href: "/accessibility/" }, "Accessibility features and help"));
  root.appendChild(actions);
  container.replaceChildren(root);

  const sync = (choices: Choices) => {
    for (const radio of radios) radio.checked = valueFor(choices, radio.dataset.setting as keyof Choices) === radio.value;
  };
  sync(settings.current);
  settings.subscribe(sync);
}

/** Header Display button: a native disclosure that opens a non-modal panel and never traps focus. */
export function initDisplayPanel(settings: DisplaySettings): void {
  const button = document.getElementById("display-toggle");
  const panel = document.getElementById("display-panel");
  if (!(button instanceof HTMLButtonElement) || !panel) return;
  const body = panel.querySelector<HTMLElement>("[data-display-form]") ?? panel;
  renderSettingsForm(body, settings, { prefix: "panel", accessibilityLink: true });

  const isOpen = () => button.getAttribute("aria-expanded") === "true";
  const open = () => { panel.hidden = false; button.setAttribute("aria-expanded", "true"); };
  const close = (returnFocus: boolean) => {
    if (!isOpen()) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  };
  const inside = (node: EventTarget | null) => node instanceof Node && (panel.contains(node) || button.contains(node));

  button.addEventListener("click", () => isOpen() ? close(false) : open());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    if (inside(document.activeElement) || document.activeElement === document.body) { event.preventDefault(); close(true); }
  });
  document.addEventListener("pointerdown", (event) => { if (isOpen() && !inside(event.target)) close(false); });
  // Focus leaving the button and panel closes it, so the panel never covers the focused element (2.4.11).
  for (const node of [button, panel]) {
    node.addEventListener("focusout", (event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (isOpen() && next && !inside(next)) close(false);
    });
  }
}

export function initInlineSettings(settings: DisplaySettings): void {
  const container = document.querySelector<HTMLElement>("[data-display-settings-inline]");
  if (container) renderSettingsForm(container, settings, { prefix: "page", accessibilityLink: false });
}

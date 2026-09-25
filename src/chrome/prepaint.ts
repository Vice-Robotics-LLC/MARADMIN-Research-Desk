// Pre-paint Display settings resolver. The build inlines PREPAINT_SOURCE into the <head> of every
// page, and the Worker's Content-Security-Policy allows exactly this script by hash. Any edit to the
// source must update PREPAINT_CSP_HASH; tests/display-settings.test.ts fails when the two diverge.
//
// It reads only the explicit Display choices (vice.theme and vice.a11y.v1), resolves them against
// the device preferences, and sets the resolved attributes on <html> before first paint.
export const PREPAINT_SOURCE = "(function(){var d=document.documentElement,t=\"auto\",c={};try{var s=localStorage.getItem(\"vice.theme\");if(s===\"light\"||s===\"dark\"||s===\"auto\")t=s;var j=JSON.parse(localStorage.getItem(\"vice.a11y.v1\")||\"{}\");if(j&&typeof j===\"object\"){c.contrast=j.contrast===\"more\";c.motion=j.motion===\"reduce\";c.backgrounds=j.backgrounds===\"solid\"}}catch(e){}function m(q){return!!(window.matchMedia&&window.matchMedia(q).matches)}d.setAttribute(\"data-theme\",t===\"auto\"?(m(\"(prefers-color-scheme: dark)\")?\"dark\":\"light\"):t);if(c.contrast||m(\"(prefers-contrast: more)\"))d.setAttribute(\"data-contrast\",\"more\");if(c.motion||m(\"(prefers-reduced-motion: reduce)\"))d.setAttribute(\"data-motion\",\"reduce\");if(c.backgrounds||m(\"(prefers-reduced-transparency: reduce)\"))d.setAttribute(\"data-backgrounds\",\"solid\");d.classList.add(\"js\")})();";

export const PREPAINT_CSP_HASH = "sha256-rV2RRVyYnBEz7nP/MWImthmv0iogBapJraXMsWBlL1k=";

import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { injectChrome } from "./src/chrome/partials";

const root = import.meta.dirname;

function sharedChrome(): Plugin {
  return { name: "research-desk-chrome", transformIndexHtml: { order: "pre", handler: (html) => injectChrome(html) } };
}

export default defineConfig({
  plugins: [react(), sharedChrome()],
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        accessibility: resolve(root, "accessibility/index.html"),
        support: resolve(root, "support/index.html"),
        notFound: resolve(root, "404.html")
      }
    }
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" }
  }
});

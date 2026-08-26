import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { registerWebMcpTools } from "./webmcp";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
void registerWebMcpTools().then((names) => {
  document.documentElement.dataset.webmcp = names.length ? "available" : "unavailable";
}).catch(() => {
  document.documentElement.dataset.webmcp = "unavailable";
});

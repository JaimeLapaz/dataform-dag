import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@dataform-dag/ui";
import { VsCodeBridge } from "./VsCodeBridge.js";

// Entry point bundled into the webview. Mounts the shared UI against the VS Code host bridge; the
// bridge sends `ready` on mount, and the extension replies with the built graph.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bridge={new VsCodeBridge()} />
  </StrictMode>,
);

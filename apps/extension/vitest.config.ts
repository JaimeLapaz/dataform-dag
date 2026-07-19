import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `vscode` is provided by the VS Code host at runtime and is not an installed package, so point
    // the bare specifier at our hand-rolled stub for the extension-host tests. Keep this config to
    // the alias only — the webview tests set their own `// @vitest-environment jsdom` inline.
    alias: {
      vscode: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)),
    },
  },
});

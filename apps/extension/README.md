# @dataform-dag/extension

VS Code host for the dataform-dag viewer. Renders the shared `@dataform-dag/ui` canvas inside a
webview and backs it with the `HostBridge` contract over the workspace filesystem.

What the host wires up:

- **graph** — built from the open folder's `definitions/**/*.sqlx` via the core regex parser
  (`buildGraphFromWorkspace` + `NodeFileSource`), no `dataform compile` needed.
- **openFile** — clicking "Go to file" opens the node's `.sqlx` in an editor.
- **liveWatch** — a `**/*.sqlx` file watcher rebuilds and repushes the graph on any change.
- **focusOnActive** — switching the active editor to a modeled file focuses its node.

## Run it (Extension Development Host)

1. From the workspace root: `npm install && npm run build:core`
2. Open **this folder** (`apps/extension`) in VS Code.
3. Press **F5** (`Run Dataform DAG Extension`). The `preLaunchTask` runs `npm run build` (esbuild
   bundles `dist/extension.js` + the webview `dist/webview.js`/`.css`).
4. In the new window, open a Dataform project (e.g. the `airfare-drift` repo root), then run
   **Dataform DAG: Show Graph** from the Command Palette.

## Build notes

`build.mjs` produces two esbuild bundles: the Node extension (CJS, `vscode` external) and the webview
UI as a single IIFE. The webview is intentionally **not** code-split so the lazy `import("elkjs")` in
the shared UI is inlined into the one nonce'd script — a separate chunk would be blocked by the
webview CSP and the layout would silently never run.

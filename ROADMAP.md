# ROADMAP

Working notes for whoever (human or Claude) picks this up next. Read `README.md` for what the tool
*is*; this file is **current state + what to do next + what not to break**.

## Where things stand (2026-07-19)

**MVP is done and green.** One shared core + one shared UI behind two hosts, all wired:

- `packages/core` — `.sqlx` regex parser, graph builder, two `GraphSource`s (regex `ParsedGraphSource`
  default; `CompiledGraphSource` shells `dataform compile --json`, Node-only). 21 tests.
- `packages/ui` — host-agnostic React Flow + ELK canvas, `HostBridge` seam, node detail, focus
  highlighting. Runs standalone via `npm run dev:ui` against a mock graph. 13 tests.
- `apps/extension` — VS Code webview host. esbuild bundles the Node extension + a single webview IIFE.
  `GraphController` implements the host side (build / openFile / liveWatch / focus). 17 tests
  (`GraphController` covered via an aliased `vscode` stub — see `test/mocks/vscode.ts`).
- `apps/web` — browser host over the File System Access API (Chromium only). 3 tests.

`npm install && npm run build:core && npm test` → **54 tests pass, typecheck clean, both hosts build.**

### Verified vs. NOT verified

Everything checkable without a human is green (typecheck, tests, bundling, `vite dev` boots). What a
machine **can't** self-check and a human still should:

1. **Extension render** — open `apps/extension` in VS Code → F5 → run *Dataform DAG: Show Graph* →
   confirm the graph renders, node-click opens the `.sqlx`, editing a `.sqlx` live-updates it.
2. **Web render** — `npm run dev -w @dataform-dag/web` → open in Chrome/Edge → pick a Dataform folder
   → confirm the graph renders.

Until someone does these two, "renders correctly" is asserted from build success, not observed.

## Next up (roughly in priority order)

1. **Add CI.** No GitHub Actions yet. Wire a workflow: `npm ci` → `npm run build:core` →
   `npm run typecheck` → `npm test` on push/PR. Fastest high-value win.
2. **Push the import commit.** The initial code-import commit is **local-only** — not yet pushed to
   `origin` (github.com/cadamsmith/dataform-dag). Confirm with the user before pushing.
3. **~~Test `apps/extension/src/extension.ts`.~~ DONE (2026-07-19).** `GraphController` (buildAndPost /
   focusActive / message routing / watcher wiring) is now covered by 14 tests in
   `test/GraphController.test.ts`. The `vscode` module is aliased to a hand-rolled stub
   (`test/mocks/vscode.ts`) via `vitest.config.ts` — it can't be `vi.mock`'d directly because it isn't
   an installed package (only `@types/vscode`); Vitest resolves the specifier before the factory runs.
   Core is mocked so the tests exercise orchestration, not core.
4. **Package the extension as a `.vsix`.** Manifest polish (real `publisher`, icon, `categories`,
   `galleryBanner`), a `.vscodeignore`, `vsce package`. Then optionally publish to the Marketplace /
   Open VSX. (Current `publisher: "dataform-dag"` is a placeholder.)
5. **Web host is local-only — NOT deployed anywhere, and there are no plans to.** It's a static bundle
   (`npm run build -w @dataform-dag/web`) run locally via `npm run dev -w @dataform-dag/web`; it exists
   for local use and as the standalone proving ground for the shared UI. Don't wire up GitHub Pages /
   Vercel / Netlify or any other hosting. Still worth doing locally: add a way to re-pick / switch
   project folders (today you pick once on landing).
6. **Expose `CompiledGraphSource` from a host.** Both hosts use the regex parser only. Add an opt-in
   "high-fidelity" mode in the extension (it has a Node process + can run the CLI) so inline
   `config.assertions` and JS-block refs show up. The seam already supports it; it's host wiring + UI.
7. **UI features** now that nodes carry `tags`: tag/layer filtering, search, collapse-by-layer. Node
   detail could show tags and the SQL preview.

## Invariants — do NOT regress these (each was a real fix)

- **Extension webview is ONE non-split IIFE bundle** (`apps/extension/build.mjs`, `splitting` off).
  The shared UI lazy-`import()`s elkjs; a separate chunk would NOT carry the webview's CSP nonce and
  would be blocked → elk never runs → graph silently falls back to dagre/bezier. Keep it inlined.
  (Verified elkjs has no `eval`/`new Function`, so the nonce-only `script-src` runs it fine — don't
  add `'unsafe-eval'` unless a future elk version needs it.)
- **`@dataform-dag/core/browser`** is the browser-safe entry (parser + graph only). The main barrel
  (`.`) re-exports `NodeFileSource` (`node:fs`) and `CompiledGraphSource` (`node:child_process`), which
  break a browser bundle. The web host imports from `/browser`. Don't route browser code through `.`.
- **`packages/ui` imports `@dataform-dag/core` for TYPES ONLY** (`import type`). This is what keeps
  core's Node-only modules out of both UI bundles. Don't add a value import from core to the UI.
- **Node identity = target name** (`config.name ?? basename`), not filename. Both graph sources key on
  it so their outputs are interchangeable. (A file can rename itself, e.g. a declaration.)
- **RF nodes are locked** (`nodesDraggable={false}`); the ELK layout is authoritative. Dragging +
  interactive relayout was built then deliberately removed (positions aren't persisted; relayout
  produced surprising crossings). Don't re-add it. Controlled RF nodes still MUST use
  `useNodesState`/`useEdgesState` + change handlers or they render frozen (React Flow #002).
- **Regex tier emits one node per file** (≈16 on the fixture); `dataform compile` emits more (≈24) —
  the extra are inline `config.assertions` Dataform synthesizes. This is the documented tier boundary,
  pinned by a golden `compile --json` fixture in core tests, NOT a bug to "fix" in the regex parser.

## Loose thread to check

- `packages/ui/src/index.ts` still exports `layoutGraph` (the dagre layout). It's the runtime fallback
  inside `useLayout` (keep that), but verify whether the *barrel export* is consumed anywhere; if not,
  it can drop from the public surface. Low priority.

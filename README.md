# 🔀 dataform-dag

Interactive DAG viewer for a Dataform project's dependency graph — parsed locally from `.sqlx`
files, no cloud connection required. Ships as **one shared core + one shared UI behind two hosts**:
a VS Code extension and a standalone local web app.

> **Status:** MVP. `packages/core` (parser + graph + graph sources) and `packages/ui` (host-agnostic
> React Flow canvas + `HostBridge` seam) are in place, and both hosts now run against real projects:
> `apps/extension` (VS Code webview) and `apps/web` (browser, File System Access API). Point either
> host at any local Dataform project — one with a `definitions/**/*.sqlx` tree.

## Layout

```
dataform-dag/
├── packages/
│   ├── core/   # pure TS: .sqlx parser + graph builder + graph sources (regex | compile)
│   └── ui/     # host-agnostic React Flow canvas + node detail, talks only via HostBridge
└── apps/
    ├── extension/  # VS Code host — webview + FileSystemWatcher, HostBridge over postMessage
    └── web/        # browser host — File System Access API, HostBridge in-page
```

## Run a host

```bash
npm install && npm run build:core

# VS Code extension: open apps/extension in VS Code, press F5, then run
# "Dataform DAG: Show Graph" in the Extension Development Host. (see apps/extension/README.md)

npm run dev -w @dataform-dag/web   # browser host → open the URL, pick a Dataform folder
```

## Try the UI standalone

```bash
npm install
npm run build:core        # ui depends on core's types
npm run dev:ui            # Vite dev server → the DAG canvas against a mock 16-node graph
```

## Parsing strategy: layered graph sources

The core exposes a `GraphSource` seam so the *same* `DataformGraph` can be produced two ways:

- **`ParsedGraphSource`** (default) — a lightweight regex parser over `.sqlx` text. No
  `@dataform/core` dependency, runs in the browser, works on a project that doesn't compile.
- **`CompiledGraphSource`** (opt-in, Node only) — shells out to `dataform compile --json` and maps
  the resolved graph. Higher fidelity (catches inline `config.assertions`, object-form refs, refs
  built in JS blocks) at the cost of requiring the CLI and a compiling project.

Both key nodes by **target name** (`config.name ?? filename`), so their output is interchangeable.

Known regex-tier limitations (by design — use `CompiledGraphSource` when they matter): inline
`config.assertions` are not materialized as separate nodes, and a `ref()` inside a **commented-out**
line of SQL is still counted as a dependency (config-block comments *are* stripped; SQL-body comments
are not). Both are covered by tests so they stay documented boundaries, not surprises.

## Develop

```bash
npm install          # from the repo root (npm workspaces)
npm run build:core
npm test             # all workspaces (core + ui + both hosts)
```

# 🔀 dataform-dag

Interactive dependency graph explorer for [Dataform](https://cloud.google.com/dataform) projects.

`dataform-dag` can inspect a project in two complementary ways:

- **Parsed graph** — fast, local `.sqlx` parsing. Works even when the project does not compile.
- **Compiled graph** — uses `dataform compile --json` for higher-fidelity dependencies and generated actions.

The repository shares one core graph model and one React UI across two hosts:

- **VS Code extension** — full experience: parsed/compiled graph, compiled SQL preview, live updates, navigation, diagnostics.
- **Standalone web app** — browser-safe parsed graph using the File System Access API.

No BigQuery connection is required to build the graph or compile SQL locally.

> `dataform compile --json` resolves Dataform code locally. It does **not** execute queries, validate referenced BigQuery tables/columns, or perform a BigQuery dry run.

## Features

### Interactive DAG

- Left-to-right dependency graph using React Flow + ELK.
- Color-coded Dataform node types.
- Minimap and graph controls.
- Click a node to inspect it.
- Open the corresponding `.sqlx` file from VS Code.
- Follow the active editor and focus its graph node.

Supported node types include:

`source` · `table` · `view` · `incremental` · `assertion` · `operations`

### Parsed and compiled graph modes

The VS Code extension can switch between:

**Parsed**

- Reads `.sqlx` files directly.
- Very fast and tolerant of incomplete projects.
- No Dataform CLI required.
- Useful while editing or when the project currently has compilation errors.

**Compiled**

- Reuses the cached result of `dataform compile --json`.
- Uses Dataform-resolved dependency targets.
- Includes actions that only exist after compilation, such as generated assertions.
- Better reflects JavaScript/includes and other dependencies that a lightweight parser cannot resolve.

Both modes use the same target-name identity model:

```text
config.name ?? filename-without-.sqlx
```

### Compiled SQL preview

From a node in the VS Code graph, open **Compiled SQL** directly inside the detail panel.

The preview supports:

- Standard table/view/assertion queries.
- Multiple SQL statements from `operations`.
- Full/initial and incremental query variants.
- `pre_operations`.
- `post_operations`.
- Incremental variants of pre/post operations.
- Dataform variables and locally resolved `${...}`, `ref()`, `self()`, includes and JavaScript.
- Copy and hide controls.

The extension caches compilation output, warms the cache in the background, debounces rapid file changes, and prevents multiple Dataform compilations from running concurrently.

### Tag filtering

Tags are treated generically — the extension does not impose concepts such as "layer" or "business domain".

Select one or more tags:

```text
silver + gold
```

or:

```text
orders + finance
```

A node is visible when at least one of its tags is selected.

The tag picker provides:

- Multi-selection.
- Search.
- `Clear all`.
- Scroll for projects with many tags.
- Persistent selection per VS Code workspace.
- Automatic removal of saved tags that no longer exist.

### Dependency context

When a tag filter is active, enable **Context** to include one direct dependency boundary around the matching nodes:

```text
raw_source        context
    │
    ▼
silver_orders     match
    │
    ▼
silver_clean      match
    │
    ▼
gold_sales        context
```

Context is intentionally **one hop only**. It does not recursively expand the whole DAG.

### Node search

Search visible nodes by name from the top bar.

Selecting a result:

- selects the node,
- opens its detail,
- centers the graph on it.

Search respects the current tag-filtered graph.

### Graph diagnostics

The graph can surface structural issues without inventing phantom nodes or preventing rendering:

- unresolved references/dependencies,
- duplicate graph node IDs.

In Parsed mode, unresolved references are advisory because some dependencies may only become visible after Dataform compilation.

### VS Code theme support

The UI uses VS Code theme variables for:

- light/dark backgrounds,
- foreground text,
- buttons,
- dropdowns,
- search,
- controls,
- graph edges,
- SQL preview,
- diagnostics.

Semantic node-type accent colors remain intentionally distinct.

## Repository layout

```text
dataform-dag/
├── packages/
│   ├── core/
│   │   ├── parser + graph builder
│   │   ├── parsed / compiled graph sources
│   │   └── compile-output helpers
│   └── ui/
│       ├── React Flow + ELK graph
│       ├── filters / search / diagnostics
│       └── HostBridge protocol
└── apps/
    ├── extension/   # VS Code host
    └── web/         # local browser host
```

## Requirements

For the repository:

- Node.js
- npm

For Parsed mode:

- A Dataform project containing `.sqlx` definitions.

For VS Code Compiled mode / Compiled SQL:

- Dataform CLI available as `dataform` on `PATH`.
- A Dataform project that can be compiled locally.

A BigQuery connection is not required for local compilation.

## Install dependencies

From the repository root:

```bash
npm install
npm run build:core
```

`packages/ui` and the hosts consume the core package declarations, so rebuild the core after changing exported core types:

```bash
npm run build:core
```

## Run the VS Code extension

Open:

```text
apps/extension
```

as the VS Code workspace and press `F5`.

In the Extension Development Host:

1. Open a Dataform project folder.
2. Open the Command Palette.
3. Run **Dataform DAG: Show Graph**.

See [`apps/extension/README.md`](apps/extension/README.md) for extension-specific details.

## Run the standalone web host

```bash
npm run dev -w @dataform-dag/web
```

Open the local Vite URL in a Chromium-based browser and choose a Dataform project folder.

The web host uses the browser-safe parser and does not run the local Dataform CLI.

## Run the shared UI with mock data

```bash
npm run dev:ui
```

## Development checks

```bash
npm run build:core
npm run typecheck
npm test
```

When changing exported types in `packages/core`, run `npm run build:core` before typechecking consumers so `dist/*.d.ts` is current.

## Parsing strategy and known boundaries

The parsed graph is intentionally lightweight. It is useful because it remains fast and usable when compilation is unavailable or temporarily broken.

Known Parsed-mode boundaries include:

- generated `config.assertions` are not materialized the same way as the compiled graph,
- JavaScript-generated dependencies can require compilation for full fidelity,
- SQL-body comments can still contain text that resembles `ref()` and be seen by the lightweight parser.

Use **Compiled** mode when Dataform's resolved graph is the source of truth you need.

## Local compilation vs BigQuery validation

Compiled SQL in this project means:

```text
.sqlx / JS / includes / vars
        ↓
dataform compile --json
        ↓
resolved local SQL
```

It does **not** mean:

```text
BigQuery execution
BigQuery dry run
table existence validation
column/type validation against warehouse metadata
```

Those require BigQuery and are intentionally outside the local graph/preview workflow.

## Packaging the extension

From `apps/extension`:

```bash
npm run package
```

The extension is bundled before packaging and does not require shipping workspace `node_modules`.

## Contributing

Keep the shared architecture boundaries intact:

- Browser code must use the browser-safe core entry where required.
- UI code should not introduce Node-only runtime imports.
- Parsed and Compiled graph modes should remain interchangeable at the serialized graph boundary.
- Node identity is the Dataform target name, not necessarily the filename.
- ELK layout remains authoritative; graph nodes are intentionally not draggable.

See [`ROADMAP.md`](ROADMAP.md) for current priorities and invariants.

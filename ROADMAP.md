# ROADMAP

Current state, priorities, and invariants for `dataform-dag`.

Last updated: **2026-08-23**

Read [`README.md`](README.md) for the user/developer overview. This file focuses on what is implemented, what is next, and what should not regress.

## Current state

The project now has one shared core graph model and one shared UI behind two hosts.

### `packages/core`

Implemented:

- Lightweight `.sqlx` parser.
- `ref()` dependency extraction.
- Explicit `config.dependencies` support.
- `config.name` target identity.
- Graph construction and serialization.
- Parsed and compiled graph sources.
- `dataform compile --json` integration.
- Compile-output lookup by file and target name.
- Table, operation and assertion compile-output mapping.
- Graph diagnostics for unresolved references.
- Graph diagnostics for duplicate node IDs.

### `packages/ui`

Implemented:

- React Flow graph canvas.
- ELK layout with fallback layout.
- Node detail panel.
- VS Code theme integration.
- Tag display.
- Searchable multi-select tag filter.
- Persistent tag-filter state supplied by the host.
- One-hop dependency context around tag-filtered nodes.
- Node-name search and graph navigation.
- Compilation status indicator.
- Inline Compiled SQL preview.
- Copy / Hide controls.
- Graph diagnostics UI.
- Parsed / Compiled graph-mode selector when supported by the host.

### `apps/extension`

Implemented:

- VS Code webview host.
- `Dataform DAG: Show Graph`.
- Open selected `.sqlx`.
- Focus graph node from active editor.
- File-system watchers.
- Parsed graph as the fast/default mode.
- Compiled graph mode backed by `dataform compile --json`.
- Compiled SQL preview.
- Full/initial and incremental SQL variants.
- `operations` query arrays.
- `pre_operations` / `post_operations`.
- Incremental pre/post-operation variants.
- Compilation cache.
- Background warm-up.
- Debounce for rapid project changes.
- Protection against concurrent Dataform compilations.
- Cache invalidation for `.sqlx`, JS modules and Dataform configuration.
- Persistent selected tags via VS Code `workspaceState`.
- VSIX packaging.

### `apps/web`

Implemented:

- Local browser host using the File System Access API.
- Parsed graph.
- Shared UI and tag filtering.
- No Node/Dataform CLI functionality.

The web host remains intentionally local-only.

## Parsed vs Compiled

### Parsed

Use when:

- editing quickly,
- the project does not currently compile,
- Dataform CLI is unavailable,
- lightweight dependency discovery is sufficient.

Advantages:

- fast,
- tolerant,
- browser-safe,
- no compile process.

Limitations:

- cannot fully resolve JS-generated graph structure,
- generated assertions differ from compiled output,
- lightweight parsing may report an unresolved dependency that compilation later resolves.

### Compiled

Use when:

- graph fidelity matters,
- generated assertions should be visible,
- dependencies are created through JS/includes,
- the locally resolved Dataform graph is needed.

Implementation rule:

> Compiled graph and Compiled SQL must reuse the same cached compilation output. Do not introduce a second independent `dataform compile` pipeline.

## Compiled SQL scope

The extension resolves local Dataform compilation output.

Supported preview content includes:

- main query,
- incremental query,
- operation query arrays,
- pre operations,
- post operations,
- incremental pre/post operations.

This is **not** a BigQuery validator.

The extension does not currently:

- execute SQL,
- issue BigQuery dry runs,
- verify table existence,
- verify columns or types against warehouse metadata.

Keep local compilation and warehouse validation conceptually separate.

## Filtering and navigation

Tag filtering is intentionally generic.

Do not hardcode meanings such as:

- raw,
- silver,
- gold,
- layer,
- business domain.

Current semantics:

```text
selectedTags ∩ node.tags != empty
```

Multiple selected tags therefore behave as OR.

The optional **Context** mode includes only direct upstream/downstream boundary nodes. It must remain one hop unless the UI explicitly introduces a different expansion mode.

Node search is navigation, not another graph filter.

## Diagnostics

Current diagnostics:

- unresolved references,
- duplicate graph IDs.

Important distinction:

- In Parsed mode, unresolved references can be parser limitations.
- In Compiled mode, the graph represents Dataform-resolved output and is a higher-fidelity diagnostic context.

Potential future diagnostic improvements:

- distinguish unresolved `ref()` from explicit `config.dependencies`,
- link diagnostics directly to source locations where possible,
- summarize diagnostics by kind,
- detect suspicious/self dependencies,
- detect cycles explicitly and expose them in the UI,
- make diagnostics filterable.

## Next priorities

### 1. CI

Add GitHub Actions for:

```text
npm ci
npm run build:core
npm run typecheck
npm test
```

Run on pushes and pull requests.

This remains the highest-value maintenance improvement.

### 2. Real VSIX smoke test

Automated tests cover orchestration, but installation/rendering of the packaged `.vsix` should be smoke-tested in a real VS Code instance.

Validate:

- extension installation,
- graph rendering,
- Parsed/Compiled switching,
- Compiled SQL preview,
- file navigation,
- theme switching,
- tag persistence.

### 3. Large-project performance

Exercise projects with hundreds or thousands of actions.

Measure:

- ELK layout time,
- React Flow render time,
- serialization cost,
- node-search responsiveness,
- tag-filter responsiveness,
- compile cache hit/miss behavior.

Potential optimizations should be measured before implementation.

### 4. Compilation cancellation

Current orchestration prevents concurrent Dataform compilation but does not terminate an already-running stale child process.

Future improvement:

- retain the spawned process handle,
- cancel stale compilation when safe,
- keep generation guards as protection against stale results.

Only add this if real projects show long compile times where cancellation matters.

### 5. Accessibility / keyboard UX

Improve:

- keyboard navigation in Node Search,
- keyboard navigation in Tag Filter,
- active option semantics,
- focus trapping/closing for dropdown-like controls,
- diagnostic item navigation.

### 6. Source-level diagnostics

Where feasible, enrich graph issues with:

- line/column,
- dependency kind,
- actionable source link.

### 7. Web-host ergonomics

The web host is a local proving ground, not a deployment target.

Useful local-only improvements:

- re-pick/switch project folder,
- clearer browser capability messaging,
- retain selected folder where browser APIs permit.

Do not add cloud deployment unless project goals explicitly change.

### 8. Documentation and release hygiene

Keep synchronized:

- root `README.md`,
- `apps/extension/README.md`,
- `ROADMAP.md`,
- extension manifest description/features,
- screenshots.

Before release:

- verify version,
- rebuild core declarations,
- run typecheck/tests,
- build/package VSIX,
- manually smoke-test the package.

## Invariants — do not regress

### One webview bundle

The VS Code webview must remain one non-split IIFE bundle.

The shared UI lazy-loads ELK-related code; extra webview chunks can conflict with the CSP nonce model.

Do not enable code splitting without revisiting CSP/loading behavior.

### Browser-safe core boundary

Browser code must not pull Node-only modules such as:

- `node:fs`,
- `node:child_process`.

Use the browser-safe core surface for browser/runtime imports.

UI imports from core should remain type-only where possible.

### Core declaration build

Consumers resolve package declarations from `packages/core/dist`.

After changing exported core types, rebuild core before consumer typechecking:

```bash
npm run build:core
npm run typecheck
```

Do not mistake stale `dist/*.d.ts` for source-level type errors.

### Node identity

Graph node identity is the Dataform target name:

```text
config.name ?? filename-without-.sqlx
```

Explicit dependencies and compiled dependency targets must resolve against this identity.

### Parsed and compiled graphs share one serialized contract

Filtering, layout, search, diagnostics and node detail should work on either graph mode without mode-specific UI graph models.

### Compiled graph reuses compilation cache

Do not make switching to Compiled graph launch a separate compile path when valid output is already cached.

### Stale compilation output must never win

Compilation generation guards prevent a result produced for an old project state from replacing current cached output.

Preserve this behavior even if cancellation is added later.

### Debounced warm-up

Rapid file-system events should collapse into a single background compile request.

Do not reintroduce one `dataform compile` per watcher event.

### ELK layout owns positions

React Flow nodes are intentionally not draggable.

Do not reintroduce free node dragging unless position persistence and relayout semantics are deliberately redesigned.

### Parsed graph remains tolerant

Do not turn Parsed mode into a compiler.

Its value is that it can still render useful information when Dataform compilation is unavailable or broken.

### Tag semantics remain generic

Do not hardcode organization-specific tag conventions into the graph engine.

## Release checklist

```bash
npm install
npm run build:core
npm run typecheck
npm test
npm run build
```

Then package and smoke-test the extension from `apps/extension`.

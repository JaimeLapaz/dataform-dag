# 🔀 dataform-dag

Explore your [Dataform](https://cloud.google.com/dataform) project's dependency graph as an interactive diagram,
right inside VS Code. The graph is parsed locally from your `.sqlx` files — **no `dataform compile`,
no warehouse connection, no cloud.**

<img width="3374" height="1372" alt="image" src="https://github.com/user-attachments/assets/3d1dfb01-788e-4384-9f75-b36057dc909a" />

## Features

- **See the whole graph at a glance.** Every model, source, view, and assertion in your project,
  laid out left-to-right by dependency with a color-coded legend and a minimap for large projects.
- **Jump straight to the code.** Click a node to open its `.sqlx` file in the editor.
- **Follow along as you navigate.** Switch the active editor to a modeled file and its node is
  highlighted on the canvas.
- **Live updates.** Edit and save any `.sqlx` and the graph rebuilds automatically — no refresh.
- **Fast and offline.** Parses `.sqlx` directly, so it works even on a project that doesn't compile.

## Getting started

1. Open a Dataform project folder in VS Code (one with a `definitions/**/*.sqlx` tree).
2. Open the Command Palette (`Cmd`/`Ctrl` + `Shift` + `P`) and run **Dataform DAG: Show Graph**.
3. The graph opens in a new panel. Click any node to open its file; edit and save to see it update.

## Node types

The legend across the top color-codes each node by its Dataform type:

**source** · **table** · **view** · **incremental** · **assertion** · **operations**

## Requirements

- VS Code `1.90.0` or newer.
- A Dataform project with a `definitions/` folder of `.sqlx` files.

## Notes

The graph is built by parsing `.sqlx` text directly, which is what keeps it fast and dependency-free.
As a result, assertions declared inline in a model's `config` block are folded into that model rather
than shown as separate nodes, and a `ref()` inside a commented-out line of SQL is still counted as a
dependency. For most projects the parsed graph matches the compiled one node-for-node.

---

Source and contribution guide: [github.com/cadamsmith/dataform-dag](https://github.com/cadamsmith/dataform-dag)

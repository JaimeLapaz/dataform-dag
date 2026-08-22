import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SerializedGraph } from "@dataform-dag/core";
import type { DagGraphProps } from "../src/DagGraph.js";

// Stub the React Flow canvas: jsdom can't lay it out, and these tests are about App wiring
// (capability gating, selection → detail panel), not the canvas. The stub exposes a select button
// per node so we can drive selection deterministically.
vi.mock("../src/DagGraph.js", () => ({
  DagGraph: ({ graph, onSelectNode }: DagGraphProps) => (
    <div data-testid="canvas">
      {graph.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelectNode(n.id)}>
          {`select:${n.id}`}
        </button>
      ))}
      <button type="button" onClick={() => onSelectNode(null)}>
        pane
      </button>
    </div>
  ),
}));

import { App } from "../src/App.js";
import { MockBridge } from "../src/MockBridge.js";

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "def/src.sqlx", type: "source", tags: [], refs: [] },
    { id: "mid", filePath: "def/mid.sqlx", type: "table", tags: ["core"], refs: ["src"], description: "a middle node" },
  ],
  downstream: [["src", ["mid"]]],
};

const taggedGraph: SerializedGraph = {
  nodes: [
    {
      id: "raw_orders",
      filePath: "def/raw_orders.sqlx",
      type: "table",
      tags: ["raw", "orders"],
      refs: [],
    },
    {
      id: "silver_orders",
      filePath:
        "def/silver_orders.sqlx",
      type: "table",
      tags: ["silver", "orders"],
      refs: [],
    },
    {
      id: "gold_orders",
      filePath:
        "def/gold_orders.sqlx",
      type: "table",
      tags: ["gold", "orders"],
      refs: [],
    },
    {
      id: "gold_sales",
      filePath:
        "def/gold_sales.sqlx",
      type: "table",
      tags: ["gold", "sales"],
      refs: [],
    },
    {
      id: "finance_report",
      filePath:
        "def/finance_report.sqlx",
      type: "table",
      tags: ["finance"],
      refs: [],
    },
  ],

  downstream: [],
};

describe("App", () => {
  it("requests the graph on mount and renders the node count", async () => {
    const bridge = new MockBridge(graph);
    render(<App bridge={bridge} />);
    expect(bridge.sent[0]).toEqual({ type: "ready" });
    expect(await screen.findByText("2 nodes")).toBeInTheDocument();
  });

  it("shows Refresh only when the host does not live-watch, and sends requestRefresh", async () => {
    const bridge = new MockBridge(graph, { liveWatch: false });
    render(<App bridge={bridge} />);
    const refresh = await screen.findByRole("button", { name: "Refresh" });
    await userEvent.click(refresh);
    expect(bridge.sent).toContainEqual({ type: "requestRefresh" });
  });

  it("hides Refresh when the host live-watches", async () => {
    render(<App bridge={new MockBridge(graph, { liveWatch: true })} />);
    await screen.findByText("2 nodes");
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("opens a detail panel on select with upstream/downstream, and gates Go to file on capability", async () => {
    const bridge = new MockBridge(graph, { openFile: true });
    render(<App bridge={bridge} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("heading", { name: "mid" })).toBeInTheDocument();
    expect(within(panel).getByText("a middle node")).toBeInTheDocument();
    // upstream "src" appears as a clickable neighbor
    expect(within(panel).getByRole("button", { name: "src" })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Go to file" }));
    expect(bridge.sent).toContainEqual({ type: "openFile", nodeId: "mid", filePath: "def/mid.sqlx" });
  });

  it("clears the detail panel when the canvas background is clicked", async () => {
    render(<App bridge={new MockBridge(graph)} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "pane" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("hides Go to file when the host cannot open files", async () => {
    render(<App bridge={new MockBridge(graph, { openFile: false })} />);
    await userEvent.click(await screen.findByRole("button", { name: "select:mid" }));
    expect(screen.queryByRole("button", { name: "Go to file" })).not.toBeInTheDocument();
  });
  it(
    "shows compilation status for hosts that support compiled SQL",
    async () => {
      const bridge = new MockBridge(
        graph,
        {
          compiledSql: true,
        },
      );

      render(
        <App bridge={bridge} />,
      );

      await userEvent.click(
        await screen.findByRole(
          "button",
          {
            name: "select:mid",
          },
        ),
      );

      act(() => {
        bridge.emit({
          type: "compilationStatus",
          status: "compiling",
        });
      });

      expect(
        await screen.findByText(
          "Compiling…",
        ),
      ).toBeInTheDocument();

      act(() => {
        bridge.emit({
          type: "compilationStatus",
          status: "ready",
        });
      });

      expect(
        await screen.findByText(
          "✓ Compiled",
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByText(
          "Compiling…",
        ),
      ).not.toBeInTheDocument();
    },
  );
  it(
    "persists selected tag filters",
    async () => {
      const taggedGraph: SerializedGraph = {
        nodes: [
          {
            id: "silver",
            filePath:
              "def/silver.sqlx",
            type: "table",
            tags: ["silver"],
            refs: [],
          },
          {
            id: "gold",
            filePath:
              "def/gold.sqlx",
            type: "table",
            tags: ["gold"],
            refs: [],
          },
          {
            id: "raw",
            filePath:
              "def/raw.sqlx",
            type: "table",
            tags: ["raw"],
            refs: [],
          },
        ],
        downstream: [],
      };

      const bridge =
        new MockBridge(
          taggedGraph,
        );

      render(
        <App bridge={bridge} />,
      );

      const silver =
        await screen.findByRole(
          "checkbox",
          {
            name: "silver",
          },
        );

      await userEvent.click(
        silver,
      );

      expect(
        bridge.sent,
      ).toContainEqual({
        type: "setTagFilter",
        selectedTags: [
          "silver",
        ],
      });

      expect(
        await screen.findByText(
          "1 / 3 nodes",
        ),
      ).toBeInTheDocument();
    },
  );
  it(
    "searches available tags in the tag dropdown",
    async () => {
      const bridge =
        new MockBridge(taggedGraph);

      render(
        <App bridge={bridge} />,
      );

      await screen.findByText(
        "5 nodes",
      );

      const tagsLabel =
        screen.getByText("Tags");

      const summary =
        tagsLabel.closest("summary");

      expect(summary).not.toBeNull();

      await userEvent.click(summary!);

      const search =
        screen.getByPlaceholderText(
          "Search tags...",
        );

      await userEvent.type(
        search,
        "sil",
      );

      expect(
        screen.getByRole(
          "checkbox",
          {
            name: "silver",
          },
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole(
          "checkbox",
          {
            name: "gold",
          },
        ),
      ).not.toBeInTheDocument();

      expect(
        screen.queryByRole(
          "checkbox",
          {
            name: "orders",
          },
        ),
      ).not.toBeInTheDocument();
    },
  );
  it(
    "filters by multiple selected tags",
    async () => {
      const bridge =
        new MockBridge(taggedGraph);

      render(
        <App bridge={bridge} />,
      );

      await screen.findByText(
        "5 nodes",
      );

      const summary =
        screen
          .getByText("Tags")
          .closest("summary");

      expect(summary).not.toBeNull();

      await userEvent.click(summary!);

      await userEvent.click(
        screen.getByRole(
          "checkbox",
          {
            name: "silver",
          },
        ),
      );

      expect(
        await screen.findByText(
          "1 / 5 nodes",
        ),
      ).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole(
          "checkbox",
          {
            name: "gold",
          },
        ),
      );

      expect(
        await screen.findByText(
          "3 / 5 nodes",
        ),
      ).toBeInTheDocument();

      expect(
        bridge.sent,
      ).toContainEqual({
        type: "setTagFilter",
        selectedTags: [
          "silver",
          "gold",
        ],
      });
    },
  );
  it(
    "clears all selected tags",
    async () => {
      const bridge =
        new MockBridge(taggedGraph);

      render(
        <App bridge={bridge} />,
      );

      await screen.findByText(
        "5 nodes",
      );

      const summary =
        screen
          .getByText("Tags")
          .closest("summary");

      expect(summary).not.toBeNull();

      await userEvent.click(summary!);

      await userEvent.click(
        screen.getByRole(
          "checkbox",
          {
            name: "silver",
          },
        ),
      );

      await userEvent.click(
        screen.getByRole(
          "checkbox",
          {
            name: "gold",
          },
        ),
      );

      expect(
        await screen.findByText(
          "3 / 5 nodes",
        ),
      ).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole(
          "button",
          {
            name: "Clear all",
          },
        ),
      );

      expect(
        await screen.findByText(
          "5 nodes",
        ),
      ).toBeInTheDocument();

      expect(
        bridge.sent,
      ).toContainEqual({
        type: "setTagFilter",
        selectedTags: [],
      });
    },
  );
  it(
    "restores persisted tag filters on mount",
    async () => {
      const bridge =
        new MockBridge(
          taggedGraph,
          {},
          [
            "silver",
            "gold",
          ],
        );

      render(
        <App bridge={bridge} />,
      );

      expect(
        await screen.findByText(
          "3 / 5 nodes",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "silver, gold",
        ),
      ).toBeInTheDocument();

      const summary =
        screen
          .getByText("Tags")
          .closest("summary");

      expect(summary).not.toBeNull();

      await userEvent.click(summary!);

      expect(
        screen.getByRole(
          "checkbox",
          {
            name: "silver",
          },
        ),
      ).toBeChecked();

      expect(
        screen.getByRole(
          "checkbox",
          {
            name: "gold",
          },
        ),
      ).toBeChecked();

      expect(
        screen.getByRole(
          "checkbox",
          {
            name: "raw",
          },
        ),
      ).not.toBeChecked();
    },
  );
  it(
    "shows an empty state when no tags match the search",
    async () => {
      const bridge =
        new MockBridge(taggedGraph);

      render(
        <App bridge={bridge} />,
      );

      await screen.findByText(
        "5 nodes",
      );

      const summary =
        screen
          .getByText("Tags")
          .closest("summary");

      expect(summary).not.toBeNull();

      await userEvent.click(summary!);

      await userEvent.type(
        screen.getByPlaceholderText(
          "Search tags...",
        ),
        "does-not-exist",
      );

      expect(
        screen.getByText(
          "No matching tags",
        ),
      ).toBeInTheDocument();
    },
  );
});

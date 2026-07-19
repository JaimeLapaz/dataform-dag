import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
});

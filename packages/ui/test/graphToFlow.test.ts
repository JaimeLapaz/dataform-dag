import { describe, expect, it } from "vitest";
import type { SerializedGraph } from "@dataform-dag/core";
import {
  NODE_COLORS,
  downstreamOf,
  indexGraph,
  layoutGraph,
  upstreamOf,
  filterGraphByTags,
  graphTags,
} from "../src/graphToFlow.js";

const graph: SerializedGraph = {
  nodes: [
    { id: "src", filePath: "src.sqlx", type: "source", tags: [], refs: [] },
    { id: "mid", filePath: "mid.sqlx", type: "incremental", tags: [], refs: ["src"] },
    { id: "leaf", filePath: "leaf.sqlx", type: "table", tags: [], refs: ["mid", "missing"] },
  ],
  downstream: [
    ["src", ["mid"]],
    ["mid", ["leaf"]],
  ],
};

describe("layoutGraph", () => {
  const flow = layoutGraph(graph);
  it("emits one positioned node per graph node, colored by type", () => {
    expect(flow.nodes).toHaveLength(3);
    const leaf = flow.nodes.find((n) => n.id === "leaf")!;
    expect(leaf.data.color).toBe(NODE_COLORS.table);
    expect(Number.isFinite(leaf.position.x)).toBe(true);
    expect(Number.isFinite(leaf.position.y)).toBe(true);
  });
  it("draws an edge per resolvable ref and drops refs to absent nodes", () => {
    expect(flow.edges.map((e) => e.id).sort()).toEqual(["mid->leaf", "src->mid"]);
    // leaf refs "missing", which has no node — no phantom edge.
    expect(flow.edges.some((e) => e.source === "missing" || e.target === "missing")).toBe(false);
  });
});

describe("index lookups", () => {
  const index = indexGraph(graph);
  it("upstream lists only refs that resolve to a node", () => {
    expect(upstreamOf(index, "leaf")).toEqual(["mid"]); // "missing" filtered out
    expect(upstreamOf(index, "src")).toEqual([]);
  });
  it("downstream reads the inverted map", () => {
    expect(downstreamOf(index, "src")).toEqual(["mid"]);
    expect(downstreamOf(index, "leaf")).toEqual([]);
  });
});

describe("tag filtering", () => {
  const taggedGraph: SerializedGraph = {
    nodes: [
      {
        id: "raw_orders",
        filePath: "raw_orders.sqlx",
        type: "table",
        tags: ["raw", "orders"],
        refs: [],
      },
      {
        id: "silver_orders",
        filePath: "silver_orders.sqlx",
        type: "table",
        tags: ["silver", "orders"],
        refs: ["raw_orders"],
      },
      {
        id: "silver_customers",
        filePath:
          "silver_customers.sqlx",
        type: "table",
        tags: [
          "silver",
          "customers",
        ],
        refs: [],
      },
      {
        id: "gold_sales",
        filePath: "gold_sales.sqlx",
        type: "table",
        tags: ["gold", "sales"],
        refs: ["silver_orders"],
      },
    ],

    downstream: [
      [
        "raw_orders",
        ["silver_orders"],
      ],
      [
        "silver_orders",
        ["gold_sales"],
      ],
    ],
  };

  it("returns every unique tag", () => {
    expect(
      graphTags(taggedGraph),
    ).toEqual([
      "customers",
      "gold",
      "orders",
      "raw",
      "sales",
      "silver",
    ]);
  });

  it("keeps nodes with the selected tag", () => {
    const filtered =
      filterGraphByTags(
        taggedGraph,
        ["silver"],
      );

    expect(
      filtered.nodes.map(
        (node) => node.id,
      ),
    ).toEqual([
      "silver_orders",
      "silver_customers",
    ]);
  });

  it("keeps nodes matching any selected tag", () => {
    const filtered =
      filterGraphByTags(
        taggedGraph,
        ["silver", "gold"],
      );

    expect(
      filtered.nodes.map(
        (node) => node.id,
      ),
    ).toEqual([
      "silver_orders",
      "silver_customers",
      "gold_sales",
    ]);
  });

  it("can filter by business tags", () => {
    const filtered =
      filterGraphByTags(
        taggedGraph,
        ["orders", "sales"],
      );

    expect(
      filtered.nodes.map(
        (node) => node.id,
      ),
    ).toEqual([
      "raw_orders",
      "silver_orders",
      "gold_sales",
    ]);
  });

  it("removes edges to nodes outside the selected tags", () => {
    const filtered =
      filterGraphByTags(
        taggedGraph,
        ["silver"],
      );

    expect(
      filtered.downstream,
    ).toEqual([]);
  });

  it("keeps edges between visible nodes", () => {
    const filtered =
      filterGraphByTags(
        taggedGraph,
        ["silver", "gold"],
      );

    expect(
      filtered.downstream,
    ).toEqual([
      [
        "silver_orders",
        ["gold_sales"],
      ],
    ]);
  });

  it("returns the original graph when no tags are selected", () => {
    expect(
      filterGraphByTags(
        taggedGraph,
        [],
      ),
    ).toBe(taggedGraph);
  });
});
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  deserializeGraph,
  getAncestors,
  getDescendants,
  serializeGraph,
  parseSqlx,
  type DataformNode,
} from "../src/index.js";

const node = (id: string, refs: string[] = [], type: DataformNode["type"] = "table"): DataformNode => ({
  id,
  filePath: `${id}.sqlx`,
  type,
  tags: [],
  refs,
});

// a -> b -> c  (c depends on b depends on a), plus d depends on b
const nodes = [node("a", [], "source"), node("b", ["a"]), node("c", ["b"]), node("d", ["b"])];

describe("buildGraph", () => {
  it("inverts refs into a downstream map", () => {
    const g = buildGraph(nodes);
    expect([...(g.downstreamMap.get("b") ?? [])].sort()).toEqual(["c", "d"]);
    expect(g.downstreamMap.get("c")).toBeUndefined();
  });

  it(
    "reports a dangling ref without inventing a phantom node",
    () => {
      const g =
        buildGraph([
          node(
            "x",
            ["missing"],
          ),
        ]);

      expect(
        g.nodes.has("missing"),
      ).toBe(false);

      expect(
        getAncestors(
          g,
          "x",
        ).size,
      ).toBe(0);

      expect(
        g.issues,
      ).toContainEqual({
        kind:
          "unresolved-reference",
        nodeId: "x",
        filePath: "x.sqlx",
        reference: "missing",
      });
    },
  );
  it(
    "reports duplicate node ids",
    () => {
      const first: DataformNode = {
        ...node("customers"),
        filePath:
          "definitions/a.sqlx",
      };

      const second:
        DataformNode = {
        ...node("customers"),
        filePath:
          "definitions/b.sqlx",
      };

      const g =
        buildGraph([
          first,
          second,
        ]);

      expect(
        g.nodes.size,
      ).toBe(1);

      expect(
        g.issues,
      ).toContainEqual({
        kind:
          "duplicate-node-id",

        nodeId:
          "customers",

        filePaths: [
          "definitions/a.sqlx",
          "definitions/b.sqlx",
        ],
      });
    },
  );

  it("connects operations using explicit dependencies and config.name", () => {
    const prepare = parseSqlx(
      "definitions/prepare_data.sqlx",
      `
        config {
          type: "operations",
          name: "load_raw_data"
        }

        SELECT 1;
      `,
    );

    const process = parseSqlx(
      "definitions/process_data.sqlx",
      `
        config {
          type: "operations",
          dependencies: ["load_raw_data"]
        }

        SELECT 2;
      `,
    );

    const graph = buildGraph([
      prepare,
      process,
    ]);

    expect(
      graph.downstreamMap.get(
        "load_raw_data",
      ),
    ).toEqual(
      new Set([
        "process_data",
      ]),
    );
  });
});

describe("traversal", () => {
  const g = buildGraph(nodes);
  it("collects transitive ancestors (upstream)", () => {
    expect([...getAncestors(g, "c")].sort()).toEqual(["a", "b"]);
  });
  it("collects transitive descendants (downstream)", () => {
    expect([...getDescendants(g, "a")].sort()).toEqual(["b", "c", "d"]);
  });
  it("is cycle-safe", () => {
    const cyclic = buildGraph([node("p", ["q"]), node("q", ["p"])]);
    expect([...getAncestors(cyclic, "p")].sort()).toEqual(["p", "q"].filter((x) => x !== "p"));
    expect(getDescendants(cyclic, "p").has("q")).toBe(true);
  });
});

describe("serialize round-trip", () => {
  it("survives serialize -> deserialize unchanged", () => {
    const g = buildGraph(nodes);
    const back = deserializeGraph(serializeGraph(g));
    expect([...back.nodes.keys()].sort()).toEqual([...g.nodes.keys()].sort());
    expect([...(back.downstreamMap.get("b") ?? [])].sort()).toEqual(["c", "d"]);
    expect(
      back.issues,
    ).toEqual(
      g.issues,
    );
  });
});

import dagre from "@dagrejs/dagre";
import type { DataformNode, NodeType, SerializedGraph } from "@dataform-dag/core";

/** Fill color per node type — the legend the whole UI shares. */
export const NODE_COLORS: Record<NodeType, string> = {
  source: "#6b7280",
  table: "#2563eb",
  view: "#16a34a",
  incremental: "#ea580c",
  assertion: "#dc2626",
  operations: "#9333ea",
};

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; nodeType: NodeType; color: string };
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Routed polyline (start → bends → end) when a router (ELK) produced one; else undefined. */
  points?: Point[];
}
export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_H = 46;
const CHAR_W = 7.7; // ~monospace advance at 13px
const NODE_PAD = 54; // left accent + horizontal padding

/** Estimate a node's rendered width from its label so dagre spacing matches, and nothing truncates. */
export function nodeWidth(label: string): number {
  return Math.max(150, Math.round(label.length * CHAR_W) + NODE_PAD);
}

/**
 * Lay a {@link SerializedGraph} out left-to-right with dagre and emit React Flow nodes/edges. Pure
 * and DOM-free. An edge is drawn for every `ref` whose target node exists in the graph; a ref to an
 * absent node (external/unresolved) is dropped rather than pointing at a phantom.
 */
export function layoutGraph(graph: SerializedGraph): FlowGraph {
  const present = new Set(graph.nodes.map((n) => n.id));
  const g = new dagre.graphlib.Graph();
  // LR layered layout. Generous rank/node separation keeps the many cross-edges of a wide fact
  // graph legible; tight-tree ranking pulls ranks together for fewer long edges.
  g.setGraph({
    rankdir: "LR",
    ranker: "tight-tree",
    nodesep: 40,
    ranksep: 130,
    edgesep: 20,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) g.setNode(node.id, { width: nodeWidth(node.id), height: NODE_H });
  const edges: FlowEdge[] = [];
  for (const node of graph.nodes) {
    for (const upstream of node.refs) {
      if (!present.has(upstream)) continue;
      g.setEdge(upstream, node.id);
      edges.push({ id: `${upstream}->${node.id}`, source: upstream, target: node.id });
    }
  }
  dagre.layout(g);
  const nodes: FlowNode[] = graph.nodes.map((node) => {
    const laid = g.node(node.id);
    const width = nodeWidth(node.id);
    return {
      id: node.id,
      // dagre centers nodes; React Flow positions by top-left corner.
      position: { x: laid.x - width / 2, y: laid.y - NODE_H / 2 },
      data: { label: node.id, nodeType: node.type, color: NODE_COLORS[node.type] },
      width,
      height: NODE_H,
    };
  });
  return { nodes, edges };
}

/** Direct-neighbor lookups for the detail panel, built once from the wire form. */
export interface GraphIndex {
  byId: Map<string, DataformNode>;
  downstream: Map<string, string[]>;
}

export function indexGraph(graph: SerializedGraph): GraphIndex {
  return {
    byId: new Map(graph.nodes.map((n) => [n.id, n])),
    downstream: new Map(graph.downstream),
  };
}

/** Direct upstream deps of a node that actually resolve to a node in the graph. */
export function upstreamOf(index: GraphIndex, nodeId: string): string[] {
  const node = index.byId.get(nodeId);
  if (!node) return [];
  return node.refs.filter((r) => index.byId.has(r));
}

/** Direct downstream dependents of a node. */
export function downstreamOf(index: GraphIndex, nodeId: string): string[] {
  return index.downstream.get(nodeId) ?? [];
}

export interface TagFilteredGraph {
  graph: SerializedGraph;

  matchedNodeIds: Set<string>;

  boundaryNodeIds: Set<string>;
}

export function filterGraphByTagsWithBoundary(
  graph: SerializedGraph,
  selectedTags: string[],
  includeBoundary: boolean,
): TagFilteredGraph {
  /*
   * No active filter = full graph.
   */
  if (selectedTags.length === 0) {
    return {
      graph,
      matchedNodeIds: new Set(
        graph.nodes.map((node) => node.id),
      ),
      boundaryNodeIds: new Set(),
    };
  }

  const byId = new Map(
    graph.nodes.map((node) => [
      node.id,
      node,
    ]),
  );

  /*
   * Normal tag matches.
   *
   * The semantics remain:
   *
   * selectedTags ∩ node.tags !== ∅
   */
  const matchedNodeIds = new Set(
    graph.nodes
      .filter((node) =>
        selectedTags.some((tag) =>
          node.tags.includes(tag),
        ),
      )
      .map((node) => node.id),
  );

  const visibleNodeIds =
    new Set(matchedNodeIds);

  /*
   * Add only direct upstream/downstream
   * neighbours.
   */
  if (includeBoundary) {
    for (const nodeId of matchedNodeIds) {
      const node = byId.get(nodeId);

      if (!node) {
        continue;
      }

      /*
       * Direct upstream nodes.
       */
      for (const ref of node.refs) {
        if (byId.has(ref)) {
          visibleNodeIds.add(ref);
        }
      }
    }

    /*
     * Direct downstream nodes.
     */
    for (
      const [
        nodeId,
        dependents,
      ] of graph.downstream
    ) {
      if (matchedNodeIds.has(nodeId)) {
        for (
          const dependentId
          of dependents
        ) {
          if (byId.has(dependentId)) {
            visibleNodeIds.add(
              dependentId,
            );
          }
        }
      }

      /*
       * Also cover the reverse lookup explicitly
       * in case downstream data is the only source
       * available for a relationship.
       */
      for (
        const dependentId
        of dependents
      ) {
        if (
          matchedNodeIds.has(
            dependentId,
          ) &&
          byId.has(nodeId)
        ) {
          visibleNodeIds.add(nodeId);
        }
      }
    }
  }

  const boundaryNodeIds =
    new Set<string>();

  for (const nodeId of visibleNodeIds) {
    if (!matchedNodeIds.has(nodeId)) {
      boundaryNodeIds.add(nodeId);
    }
  }

  /*
   * Keep only visible nodes.
   *
   * When context is enabled, also remove
   * relationships between two context nodes.
   * Every visible edge must touch at least one
   * actual tag match.
   */
  const nodes = graph.nodes
    .filter((node) =>
      visibleNodeIds.has(node.id),
    )
    .map((node) => {
      const refs = node.refs.filter(
        (ref) =>
          visibleNodeIds.has(ref) &&
          (
            !includeBoundary ||
            matchedNodeIds.has(node.id) ||
            matchedNodeIds.has(ref)
          ),
      );

      return {
        ...node,
        refs,
      };
    });

  /*
   * Rebuild downstream so it stays consistent
   * with the filtered refs above.
   */
  const downstreamMap =
    new Map<string, string[]>();

  for (const node of nodes) {
    for (const upstreamId of node.refs) {
      const dependents =
        downstreamMap.get(
          upstreamId,
        ) ?? [];

      dependents.push(node.id);

      downstreamMap.set(
        upstreamId,
        dependents,
      );
    }
  }

  const downstream: Array<
    [string, string[]]
  > = [
      ...downstreamMap.entries(),
    ];

  return {
    graph: {
      nodes,
      downstream,
    },

    matchedNodeIds,
    boundaryNodeIds,
  };
}

export function filterGraphByTags(
  graph: SerializedGraph,
  selectedTags: string[],
): SerializedGraph {
  return filterGraphByTagsWithBoundary(
    graph,
    selectedTags,
    false,
  ).graph;
}

export function graphTags(
  graph: SerializedGraph,
): string[] {
  const tags = new Set<string>();

  for (const node of graph.nodes) {
    for (const tag of node.tags) {
      tags.add(tag);
    }
  }

  return [...tags].sort((a, b) =>
    a.localeCompare(b),
  );
}
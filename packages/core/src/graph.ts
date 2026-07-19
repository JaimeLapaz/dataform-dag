import type { DataformGraph, DataformNode, SerializedGraph } from "./types.js";

/**
 * Build the immutable graph from a flat node list. Edges come from each node's `refs`; the inverse
 * `downstreamMap` is computed once here. A ref to a name that has no node (an unresolved/external
 * dependency) is kept in the node's `refs` but seeds no downstream entry — traversal simply skips
 * nodes that aren't present, so a dangling ref never crashes and never invents a phantom node.
 */
export function buildGraph(nodes: DataformNode[]): DataformGraph {
  const nodeMap = new Map<string, DataformNode>();
  for (const node of nodes) nodeMap.set(node.id, node);
  const downstreamMap = new Map<string, Set<string>>();
  for (const node of nodes) {
    for (const upstream of node.refs) {
      let set = downstreamMap.get(upstream);
      if (!set) {
        set = new Set<string>();
        downstreamMap.set(upstream, set);
      }
      set.add(node.id);
    }
  }
  return { nodes: nodeMap, downstreamMap };
}

/** All transitive upstream dependencies of `nodeId` (things it depends on). Excludes `nodeId`. */
export function getAncestors(graph: DataformGraph, nodeId: string): Set<string> {
  return traverse(nodeId, (id) => graph.nodes.get(id)?.refs ?? [], graph.nodes);
}

/** All transitive downstream dependents of `nodeId` (things that depend on it). Excludes `nodeId`. */
export function getDescendants(graph: DataformGraph, nodeId: string): Set<string> {
  return traverse(nodeId, (id) => graph.downstreamMap.get(id), graph.nodes);
}

/** Breadth-first transitive closure from `start`, following `neighbors`. Cycle-safe; skips missing nodes. */
function traverse(
  start: string,
  neighbors: (id: string) => Iterable<string> | undefined,
  present: Map<string, DataformNode>,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of neighbors(current) ?? []) {
      if (next !== start && !result.has(next) && present.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
  }
  return result;
}

/** Flatten to the wire form so it survives `JSON.stringify` / `postMessage`. */
export function serializeGraph(graph: DataformGraph): SerializedGraph {
  return {
    nodes: [...graph.nodes.values()],
    downstream: [...graph.downstreamMap.entries()].map(([id, set]) => [id, [...set]]),
  };
}

/** Inverse of {@link serializeGraph}. Rebuilds the Maps/Sets UI-side. */
export function deserializeGraph(s: SerializedGraph): DataformGraph {
  return {
    nodes: new Map(s.nodes.map((n) => [n.id, n])),
    downstreamMap: new Map(s.downstream.map(([id, ids]) => [id, new Set(ids)])),
  };
}

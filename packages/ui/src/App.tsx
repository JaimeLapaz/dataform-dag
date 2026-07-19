import { useMemo, useState } from "react";
import type { DataformNode } from "@dataform-dag/core";
import type { HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import { NODE_COLORS, downstreamOf, indexGraph, upstreamOf } from "./graphToFlow.js";
import { useLayout } from "./useLayout.js";
import { DagGraph } from "./DagGraph.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import "./app.css";

export interface AppProps {
  bridge: HostBridge;
}

/** Host-agnostic root. Knows nothing about which host embeds it — only {@link HostBridge}. */
export function App({ bridge }: AppProps): JSX.Element {
  const { graph, focusRequest } = useHostBridge(bridge);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { capabilities } = bridge;
  const flow = useLayout(graph);
  const index = useMemo(() => (graph ? indexGraph(graph) : null), [graph]);
  const selected: DataformNode | null =
    (index && selectedId && index.byId.get(selectedId)) || null;
  return (
    <div className="ddag-app">
      <header className="ddag-topbar">
        <h1 className="ddag-topbar__title">dataform-dag</h1>
        <Legend />
        <div className="ddag-topbar__spacer" />
        {graph && <span className="ddag-topbar__count">{graph.nodes.length} nodes</span>}
        {!capabilities.liveWatch && (
          <button
            type="button"
            className="ddag-btn"
            onClick={() => bridge.send({ type: "requestRefresh" })}
          >
            Refresh
          </button>
        )}
      </header>
      <div className="ddag-body">
        <main className="ddag-canvas">
          {flow ? (
            <DagGraph
              graph={flow}
              selectedId={selectedId}
              focus={focusRequest}
              onSelectNode={setSelectedId}
            />
          ) : (
            <div className="ddag-empty">Waiting for a graph…</div>
          )}
        </main>
        {selected && index && (
          <NodeDetailPanel
            node={selected}
            upstream={upstreamOf(index, selected.id)}
            downstream={downstreamOf(index, selected.id)}
            onSelect={setSelectedId}
            onOpenFile={
              capabilities.openFile
                ? (node) => bridge.send({ type: "openFile", nodeId: node.id, filePath: node.filePath })
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function Legend(): JSX.Element {
  return (
    <ul className="ddag-legend">
      {(Object.keys(NODE_COLORS) as (keyof typeof NODE_COLORS)[]).map((type) => (
        <li key={type} className="ddag-legend__item">
          <span className="ddag-legend__dot" style={{ background: NODE_COLORS[type] }} />
          {type}
        </li>
      ))}
    </ul>
  );
}

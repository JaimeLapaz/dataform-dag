import { useEffect, useMemo, useRef, useState } from "react";
import type { DataformNode } from "@dataform-dag/core";
import type { HostBridge } from "./HostBridge.js";
import { useHostBridge } from "./useHostBridge.js";
import {
  NODE_COLORS,
  downstreamOf,
  filterGraphByTagsWithBoundary,
  filterGraphByTags,
  graphTags,
  indexGraph,
  upstreamOf,
} from "./graphToFlow.js";
import { useLayout } from "./useLayout.js";
import { DagGraph } from "./DagGraph.js";
import { NodeDetailPanel } from "./NodeDetailPanel.js";
import "./app.css";
import { TagFilter } from "./TagFilter.js";
import { NodeSearch } from "./NodeSearch.js";
import {
  GraphDiagnostics,
} from "./GraphDiagnostics.js";

export interface AppProps {
  bridge: HostBridge;
}

/** Host-agnostic root. Knows nothing about which host embeds it — only {@link HostBridge}. */
export function App({ bridge }: AppProps): JSX.Element {
  const {
    graph,
    focusRequest,
    compilationStatus,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
    graphMode,
  } = useHostBridge(bridge);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [
    navigationFocus,
    setNavigationFocus,
  ] = useState<{
    nodeId: string;
    nonce: number;
  } | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [
    showBoundaryDependencies,
    setShowBoundaryDependencies,
  ] = useState(false);
  const tagFilterRestored = useRef(false);


  const persistTagFilter = (
    nextTags: string[],
  ): void => {
    setSelectedTags(nextTags);
    setSelectedId(null);

    bridge.send({
      type: "setTagFilter",
      selectedTags: nextTags,
    });
  };

  const toggleTag = (
    tag: string,
  ): void => {
    const nextTags =
      selectedTags.includes(tag)
        ? selectedTags.filter(
          (item) => item !== tag,
        )
        : [...selectedTags, tag];

    persistTagFilter(nextTags);
  };

  const clearTags = (): void => {
    setShowBoundaryDependencies(
      false,
    );

    persistTagFilter([]);
  };

  const { capabilities } = bridge;

  const availableTags = useMemo(
    () =>
      graph
        ? graphTags(graph)
        : [],
    [graph],
  );

  const tagFilteredView = useMemo(
    () =>
      graph
        ? filterGraphByTagsWithBoundary(
          graph,
          selectedTags,
          showBoundaryDependencies,
        )
        : null,
    [
      graph,
      selectedTags,
      showBoundaryDependencies,
    ],
  );

  const filteredGraph =
    tagFilteredView?.graph ?? null;

  const boundaryNodeIds =
    tagFilteredView?.boundaryNodeIds;

  const graphIssues = graph?.issues ?? [];

  const visibleNodeIds = useMemo(
    () =>
      filteredGraph
        ? filteredGraph.nodes.map(
          (node) => node.id,
        )
        : [],
    [filteredGraph],
  );

  const navigateToNode = (
    nodeId: string,
  ): void => {
    setSelectedId(nodeId);

    setNavigationFocus(
      (current) => ({
        nodeId,
        nonce:
          (current?.nonce ?? 0) + 1,
      }),
    );
  };

  const navigateToIssueNode = (
    nodeId: string,
  ): void => {
    /*
     * Diagnostics belong to the full graph.
     *
     * If a tag filter is hiding the affected node,
     * clear it before navigating.
     */
    if (
      selectedTags.length > 0
    ) {
      setSelectedTags([]);

      setShowBoundaryDependencies(
        false,
      );

      bridge.send({
        type: "setTagFilter",
        selectedTags: [],
      });
    }

    navigateToNode(nodeId);
  };

  useEffect(() => {
    setSelectedId(null);
  }, [graphMode]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    setNavigationFocus(
      focusRequest,
    );
  }, [focusRequest]);

  useEffect(() => {
    if (
      tagFilterRestored.current ||
      savedTagFilter === null
    ) {
      return;
    }

    tagFilterRestored.current = true;

    setSelectedTags(
      savedTagFilter,
    );
  }, [savedTagFilter]);

  useEffect(() => {
    if (
      !graph ||
      !tagFilterRestored.current
    ) {
      return;
    }

    const validTags =
      selectedTags.filter((tag) =>
        availableTags.includes(tag),
      );

    if (
      validTags.length ===
      selectedTags.length
    ) {
      return;
    }

    setSelectedTags(validTags);

    bridge.send({
      type: "setTagFilter",
      selectedTags: validTags,
    });
  }, [
    graph,
    availableTags,
    selectedTags,
    bridge,
  ]);

  const flow =
    useLayout(filteredGraph);

  const index = useMemo(
    () =>
      filteredGraph
        ? indexGraph(filteredGraph)
        : null,
    [filteredGraph],
  );

  const selected: DataformNode | null =
    (index && selectedId && index.byId.get(selectedId)) || null;


  return (
    <div className="ddag-app">
      <header className="ddag-topbar">
        <h1 className="ddag-topbar__title">dataform-dag</h1>
        <Legend />

        {capabilities.compiledGraph && (
          <label className="ddag-graph-mode">
            <span className="ddag-graph-mode__label">
              Graph
            </span>

            <select
              className="ddag-graph-mode__select"
              value={graphMode}
              onChange={(event) => {
                bridge.send({
                  type: "setGraphMode",
                  mode:
                    event.target.value ===
                      "compiled"
                      ? "compiled"
                      : "parsed",
                });
              }}
            >
              <option value="parsed">
                Parsed
              </option>

              <option value="compiled">
                Compiled
              </option>
            </select>
          </label>
        )}

        {graph &&
          availableTags.length > 0 && (
            <TagFilter
              tags={availableTags}
              selectedTags={selectedTags}
              onToggle={toggleTag}
              onClear={clearTags}
            />
          )}

        {selectedTags.length > 0 && (
          <label
            className="ddag-boundary-toggle"
            title={
              "Show direct upstream and downstream nodes outside the selected tags"
            }
          >
            <input
              type="checkbox"
              checked={
                showBoundaryDependencies
              }
              onChange={(event) =>
                setShowBoundaryDependencies(
                  event.target.checked,
                )
              }
            />

            <span>
              Context
            </span>
          </label>
        )}

        {filteredGraph &&
          filteredGraph.nodes.length > 0 && (
            <NodeSearch
              nodeIds={visibleNodeIds}
              onSelect={navigateToNode}
            />
          )}

        <GraphDiagnostics
          issues={graphIssues}
          graphMode={graphMode}
          onSelectNode={
            navigateToIssueNode
          }
        />

        <div className="ddag-topbar__spacer" />

        {graph && filteredGraph && (
          <span className="ddag-topbar__count">
            {selectedTags.length > 0
              ? (
                showBoundaryDependencies &&
                  tagFilteredView &&
                  tagFilteredView
                    .boundaryNodeIds.size > 0
                  ? `${tagFilteredView
                    .matchedNodeIds.size
                  } matched + ${tagFilteredView
                    .boundaryNodeIds.size
                  } context / ${graph.nodes.length
                  } nodes`
                  : `${filteredGraph.nodes.length
                  } / ${graph.nodes.length
                  } nodes`
              )
              : `${graph.nodes.length} nodes`}
          </span>
        )}


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
              focus={navigationFocus}
              boundaryNodeIds={boundaryNodeIds}
              onSelectNode={setSelectedId}
            />
          ) : (
            <div className="ddag-empty">Waiting for a graph…</div>
          )}
        </main>
        {selected && index && (
          <NodeDetailPanel
            node={selected}
            upstream={upstreamOf(
              index,
              selected.id,
            )}
            downstream={downstreamOf(
              index,
              selected.id,
            )}
            onSelect={setSelectedId}

            compilationStatus={
              capabilities.compiledSql
                ? compilationStatus
                : undefined
            }

            compiledSql={
              compiledSql?.nodeId === selected.id
                ? compiledSql.sql
                : undefined
            }

            compiledSqlError={
              compiledSqlError?.nodeId === selected.id
                ? compiledSqlError.message
                : undefined
            }

            onOpenFile={
              capabilities.openFile
                ? (node) =>
                  bridge.send({
                    type: "openFile",
                    nodeId: node.id,
                    filePath: node.filePath,
                  })
                : undefined
            }

            onShowCompiledSql={
              capabilities.compiledSql
                ? (node) =>
                  bridge.send({
                    type: "showCompiledSql",
                    nodeId: node.id,
                    filePath: node.filePath,
                  })
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

import { useEffect, useState } from "react";
import type {
  CompilationStatus,
  GraphMode,
  HostBridge,
  SerializedGraph,
} from "./HostBridge.js";

export interface HostBridgeState {
  graph: SerializedGraph | null;

  focusRequest: {
    nodeId: string;
    nonce: number;
  } | null;

  compilationStatus: CompilationStatus;

  graphMode: GraphMode;

  compiledSql: {
    nodeId: string;
    sql: string;
  } | null;

  compiledSqlError: {
    nodeId: string;
    message: string;
  } | null;

  savedTagFilter: string[] | null;
}

/**
 * Subscribe a component to a {@link HostBridge}: sends `ready` on mount (so the host knows to push
 * the initial graph), then tracks `graphUpdate` / `focusNode`. `focusRequest` carries a nonce so a
 * repeated focus of the same node still re-fires downstream effects.
 */
export function useHostBridge(bridge: HostBridge): HostBridgeState {
  const [graph, setGraph] = useState<SerializedGraph | null>(null);
  const [focusRequest, setFocusRequest] = useState<HostBridgeState["focusRequest"]>(null);
  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("idle");
  const [compiledSql, setCompiledSql] = useState<HostBridgeState["compiledSql"]>(null);
  const [compiledSqlError, setCompiledSqlError] = useState<HostBridgeState["compiledSqlError"]>(null);
  const [
    savedTagFilter,
    setSavedTagFilter,
  ] = useState<string[] | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("parsed");

  useEffect(() => {
    let nonce = 0;
    const unsubscribe =
      bridge.onMessage((msg) => {
        if (msg.type === "graphUpdate") {
          setGraph(msg.graph);
        } else if (msg.type === "focusNode") {
          setFocusRequest({
            nodeId: msg.nodeId,
            nonce: ++nonce,
          });
        } else if (
          msg.type === "compilationStatus"
        ) {
          setCompilationStatus(msg.status);

          if (
            msg.status === "idle" ||
            msg.status === "compiling"
          ) {
            setCompiledSql(null);
            setCompiledSqlError(null);
          }
        } else if (msg.type === "compiledSqlResult") {
          setCompiledSql({
            nodeId: msg.nodeId,
            sql: msg.sql,
          });
          setCompiledSqlError(null);
        } else if (msg.type === "compiledSqlError") {
          setCompiledSqlError({
            nodeId: msg.nodeId,
            message: msg.message,
          });
        } else if (msg.type === "tagFilterState") {
          setSavedTagFilter(
            msg.selectedTags,
          );
        } else if (
          msg.type === "graphModeState"
        ) {
          setGraphMode(msg.mode);
        }
      });
    bridge.send({ type: "ready" });
    return unsubscribe;
  }, [bridge]);
  return {
    graph,
    focusRequest,
    compilationStatus,
    compiledSql,
    compiledSqlError,
    savedTagFilter,
    graphMode,
  };
}

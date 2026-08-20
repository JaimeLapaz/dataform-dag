import { useEffect, useState } from "react";
import type {
  CompilationStatus,
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
        }
      });
    bridge.send({ type: "ready" });
    return unsubscribe;
  }, [bridge]);
  return {
    graph,
    focusRequest,
    compilationStatus,
  };
}

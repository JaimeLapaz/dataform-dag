import { useEffect, useState } from "react";
import type { HostBridge, SerializedGraph } from "./HostBridge.js";

export interface HostBridgeState {
  graph: SerializedGraph | null;
  /** The node the host last asked to focus (e.g. active editor changed). Cleared after consumption. */
  focusRequest: { nodeId: string; nonce: number } | null;
}

/**
 * Subscribe a component to a {@link HostBridge}: sends `ready` on mount (so the host knows to push
 * the initial graph), then tracks `graphUpdate` / `focusNode`. `focusRequest` carries a nonce so a
 * repeated focus of the same node still re-fires downstream effects.
 */
export function useHostBridge(bridge: HostBridge): HostBridgeState {
  const [graph, setGraph] = useState<SerializedGraph | null>(null);
  const [focusRequest, setFocusRequest] = useState<HostBridgeState["focusRequest"]>(null);
  useEffect(() => {
    let nonce = 0;
    const unsubscribe = bridge.onMessage((msg) => {
      if (msg.type === "graphUpdate") setGraph(msg.graph);
      else if (msg.type === "focusNode") setFocusRequest({ nodeId: msg.nodeId, nonce: ++nonce });
    });
    bridge.send({ type: "ready" });
    return unsubscribe;
  }, [bridge]);
  return { graph, focusRequest };
}

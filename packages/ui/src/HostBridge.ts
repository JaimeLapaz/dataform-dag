import type { SerializedGraph } from "@dataform-dag/core";

export type { SerializedGraph };

/** UI → host. Every payload carries a `type` discriminant; the protocol is host-independent. */
export type OutboundMsg =
  | { type: "ready" }
  | { type: "openFile"; nodeId: string; filePath: string }
  | { type: "requestRefresh" };

/** host → UI. */
export type InboundMsg =
  | { type: "graphUpdate"; graph: SerializedGraph }
  | { type: "focusNode"; nodeId: string };

/**
 * What a host can do. The UI reads these to decide what to render — a "Go to file" button only
 * when `openFile`, a manual "Refresh" button only when `!liveWatch`. A capability the host lacks
 * means the corresponding UI is hidden, never broken.
 */
export interface HostCapabilities {
  openFile: boolean;
  liveWatch: boolean;
  focusOnActive: boolean;
}

/** The seam. Each host implements exactly one of these; the UI never imports a host directly. */
export interface HostBridge {
  send(msg: OutboundMsg): void;
  /** Subscribe to host → UI messages. Returns an unsubscribe function. */
  onMessage(cb: (msg: InboundMsg) => void): () => void;
  capabilities: HostCapabilities;
}

import type { DataformNode } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";

export interface NodeDetailPanelProps {
  node: DataformNode;
  upstream: string[];
  downstream: string[];
  /** Present only when the host advertises `openFile`; rendering is gated on it. */
  onOpenFile?: (node: DataformNode) => void;
  onSelect: (nodeId: string) => void;
}

/** Type, tags, description, direct upstream/downstream, and a capability-gated "Go to file". */
export function NodeDetailPanel({
  node,
  upstream,
  downstream,
  onOpenFile,
  onSelect,
}: NodeDetailPanelProps): JSX.Element {
  return (
    <aside className="ddag-detail">
      <header className="ddag-detail__head">
        <span className="ddag-badge" style={{ background: NODE_COLORS[node.type] }}>
          {node.type}
        </span>
        <h2 className="ddag-detail__title">{node.id}</h2>
      </header>
      {node.tags.length > 0 && (
        <div className="ddag-detail__tags">
          {node.tags.map((t) => (
            <span key={t} className="ddag-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      {node.description && <p className="ddag-detail__desc">{node.description}</p>}
      <NeighborList title="Upstream (depends on)" ids={upstream} onSelect={onSelect} />
      <NeighborList title="Downstream (dependents)" ids={downstream} onSelect={onSelect} />
      {onOpenFile && (
        <button type="button" className="ddag-btn" onClick={() => onOpenFile(node)}>
          Go to file
        </button>
      )}
    </aside>
  );
}

function NeighborList({
  title,
  ids,
  onSelect,
}: {
  title: string;
  ids: string[];
  onSelect: (nodeId: string) => void;
}): JSX.Element {
  return (
    <section className="ddag-neighbors">
      <h3 className="ddag-neighbors__title">
        {title} <span className="ddag-count">{ids.length}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="ddag-neighbors__empty">none</p>
      ) : (
        <ul className="ddag-neighbors__list">
          {ids.map((id) => (
            <li key={id}>
              <button type="button" className="ddag-link" onClick={() => onSelect(id)}>
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

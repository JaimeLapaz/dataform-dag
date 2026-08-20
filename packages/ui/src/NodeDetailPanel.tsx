import type { DataformNode } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import type {
  CompilationStatus,
} from "./HostBridge.js";
import { useEffect, useState } from "react";

export interface NodeDetailPanelProps {
  node: DataformNode;
  upstream: string[];
  downstream: string[];

  onOpenFile?: (
    node: DataformNode,
  ) => void;

  onShowCompiledSql?: (
    node: DataformNode,
  ) => void;

  compilationStatus?: CompilationStatus;

  compiledSql?: string;
  compiledSqlError?: string;

  onSelect: (
    nodeId: string,
  ) => void;
}

/** Type, tags, description, direct upstream/downstream, and a capability-gated "Go to file". */
export function NodeDetailPanel({
  node,
  upstream,
  downstream,
  onOpenFile,
  onShowCompiledSql,
  compilationStatus,
  compiledSql,
  compiledSqlError,
  onSelect,
}: NodeDetailPanelProps): JSX.Element {
  const [sqlVisible, setSqlVisible] =
    useState(false);

  const [copied, setCopied] =
    useState(false);

  useEffect(() => {
    setSqlVisible(false);
    setCopied(false);
  }, [node.id]);

  const showCompiledSql = (): void => {
    setSqlVisible(true);
    setCopied(false);

    onShowCompiledSql?.(node);
  };

  const hideCompiledSql = (): void => {
    setSqlVisible(false);
    setCopied(false);
  };

  const copyCompiledSql = async (): Promise<void> => {
    if (!compiledSql) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        compiledSql,
      );

      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside
      className={[
        "ddag-detail",
        sqlVisible
          ? "ddag-detail--sql-open"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
      {(onOpenFile || onShowCompiledSql) && (
        <div className="ddag-detail__actions">
          {onOpenFile && (
            <button
              type="button"
              className="ddag-btn"
              onClick={() => onOpenFile(node)}
            >
              Go to file
            </button>
          )}

          {onShowCompiledSql && (
            <button
              type="button"
              className="ddag-btn"
              onClick={showCompiledSql}
            >
              Compiled SQL
            </button>
          )}

          {onShowCompiledSql &&
            compilationStatus &&
            compilationStatus !== "idle" && (
              <span
                className={[
                  "ddag-compilation-status",
                  `ddag-compilation-status--${compilationStatus}`,
                ].join(" ")}
                role="status"
                aria-live="polite"
              >
                {compilationStatus ===
                  "compiling" &&
                  "Compiling…"}

                {compilationStatus ===
                  "ready" &&
                  "✓ Compiled"}

                {compilationStatus ===
                  "error" &&
                  "Compilation failed"}
              </span>
            )}
        </div>
      )}
      {sqlVisible &&
        (compiledSql || compiledSqlError) && (
          <section className="ddag-sql-preview">
            <div className="ddag-sql-preview__header">
              <h3 className="ddag-sql-preview__title">
                Compiled SQL
              </h3>

              <div className="ddag-sql-preview__actions">
                {compiledSql && (
                  <button
                    type="button"
                    className="ddag-sql-preview__action"
                    onClick={() => {
                      void copyCompiledSql();
                    }}
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                )}

                <button
                  type="button"
                  className="ddag-sql-preview__action"
                  onClick={hideCompiledSql}
                >
                  Hide
                </button>
              </div>
            </div>

            {compiledSqlError ? (
              <div className="ddag-sql-preview__error">
                {compiledSqlError}
              </div>
            ) : (
              <pre className="ddag-sql-preview__code">
                <code>{compiledSql}</code>
              </pre>
            )}
          </section>
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

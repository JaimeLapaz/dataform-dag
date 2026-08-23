import type {
  GraphIssue,
} from "@dataform-dag/core";

import type {
  GraphMode,
} from "./HostBridge.js";

export interface GraphDiagnosticsProps {
  issues: GraphIssue[];
  graphMode: GraphMode;

  onSelectNode: (
    nodeId: string,
  ) => void;
}

export function GraphDiagnostics({
  issues,
  graphMode,
  onSelectNode,
}: GraphDiagnosticsProps):
  JSX.Element | null {
  if (issues.length === 0) {
    return null;
  }

  const label =
    issues.length === 1
      ? "1 issue"
      : `${issues.length} issues`;

  return (
    <details className="ddag-diagnostics">
      <summary className="ddag-diagnostics__summary">
        <span aria-hidden="true">
          ⚠
        </span>

        {label}
      </summary>

      <div className="ddag-diagnostics__menu">
        {graphMode === "parsed" && (
          <div className="ddag-diagnostics__note">
            Parsed mode is lightweight.
            JS-generated actions can appear
            unresolved even when Dataform
            compiles successfully.
          </div>
        )}

        <div className="ddag-diagnostics__items">
          {issues.map(
            (issue, index) => (
              <DiagnosticItem
                key={`${issue.kind}-${issue.nodeId}-${index}`}
                issue={issue}
                onSelectNode={
                  onSelectNode
                }
              />
            ),
          )}
        </div>
      </div>
    </details>
  );
}

function DiagnosticItem({
  issue,
  onSelectNode,
}: {
  issue: GraphIssue;

  onSelectNode: (
    nodeId: string,
  ) => void;
}): JSX.Element {
  if (
    issue.kind ===
    "unresolved-reference"
  ) {
    return (
      <div className="ddag-diagnostics__item">
        <button
          type="button"
          className="ddag-diagnostics__node"
          onClick={() =>
            onSelectNode(
              issue.nodeId,
            )
          }
        >
          {issue.nodeId}
        </button>

        <div className="ddag-diagnostics__message">
          Unresolved dependency:
          {" "}
          <code>
            {issue.reference}
          </code>
        </div>

        <div className="ddag-diagnostics__path">
          {issue.filePath}
        </div>
      </div>
    );
  }

  return (
    <div className="ddag-diagnostics__item">
      <button
        type="button"
        className="ddag-diagnostics__node"
        onClick={() =>
          onSelectNode(
            issue.nodeId,
          )
        }
      >
        {issue.nodeId}
      </button>

      <div className="ddag-diagnostics__message">
        Duplicate graph id
      </div>

      <div className="ddag-diagnostics__paths">
        {issue.filePaths.map(
          (filePath) => (
            <div key={filePath}>
              {filePath}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
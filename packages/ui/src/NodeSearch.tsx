import {
  useMemo,
  useState,
} from "react";

export interface NodeSearchProps {
  nodeIds: string[];
  onSelect: (nodeId: string) => void;
}

const MAX_RESULTS = 12;

export function NodeSearch({
  nodeIds,
  onSelect,
}: NodeSearchProps): JSX.Element {
  const [query, setQuery] =
    useState("");

  const [open, setOpen] =
    useState(false);

  const results = useMemo(() => {
    const normalized =
      query.trim().toLowerCase();

    if (!normalized) {
      return [];
    }

    return nodeIds
      .filter((nodeId) =>
        nodeId
          .toLowerCase()
          .includes(normalized),
      )
      .sort((a, b) =>
        a.localeCompare(b),
      )
      .slice(0, MAX_RESULTS);
  }, [nodeIds, query]);

  const selectNode = (
    nodeId: string,
  ): void => {
    setQuery(nodeId);
    setOpen(false);
    onSelect(nodeId);
  };

  return (
    <div
      className="ddag-node-search"
      onBlur={(event) => {
        const next =
          event.relatedTarget;

        if (
          next &&
          event.currentTarget.contains(
            next as Node,
          )
        ) {
          return;
        }

        setOpen(false);
      }}
    >
      <input
        type="search"
        className="ddag-node-search__input"
        value={query}
        placeholder="Search nodes..."
        autoComplete="off"
        aria-label="Search nodes"
        aria-expanded={open}
        aria-controls="ddag-node-search-results"
        onFocus={() =>
          setOpen(true)
        }
        onChange={(event) => {
          setQuery(
            event.target.value,
          );

          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }

          if (
            event.key === "Enter" &&
            results[0]
          ) {
            event.preventDefault();

            selectNode(
              results[0],
            );
          }
        }}
      />

      {open &&
        query.trim().length > 0 && (
          <div
            id="ddag-node-search-results"
            className="ddag-node-search__menu"
            role="listbox"
          >
            {results.length > 0 ? (
              results.map(
                (nodeId) => (
                  <button
                    key={nodeId}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="ddag-node-search__result"
                    onClick={() =>
                      selectNode(
                        nodeId,
                      )
                    }
                  >
                    {nodeId}
                  </button>
                ),
              )
            ) : (
              <div className="ddag-node-search__empty">
                No matching nodes
              </div>
            )}
          </div>
        )}
    </div>
  );
}
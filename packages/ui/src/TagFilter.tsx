import {
  useMemo,
  useState,
} from "react";

export interface TagFilterProps {
  tags: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function TagFilter({
  tags,
  selectedTags,
  onToggle,
  onClear,
}: TagFilterProps): JSX.Element {
  const [search, setSearch] =
    useState("");

  const filteredTags = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    if (!query) {
      return tags;
    }

    return tags.filter((tag) =>
      tag.toLowerCase().includes(query),
    );
  }, [tags, search]);

  const summary =
    selectedTags.length === 0
      ? "All"
      : selectedTags.length <= 2
        ? selectedTags.join(", ")
        : `${selectedTags
            .slice(0, 2)
            .join(", ")} +${
            selectedTags.length - 2
          }`;

  return (
    <details className="ddag-tag-filter">
      <summary className="ddag-tag-filter__summary">
        <span className="ddag-tag-filter__summary-label">
          Tags
        </span>

        <span className="ddag-tag-filter__summary-value">
          {summary}
        </span>
      </summary>

      <div className="ddag-tag-filter__menu">
        <input
          type="search"
          className="ddag-tag-filter__search"
          value={search}
          placeholder="Search tags..."
          autoComplete="off"
          onChange={(event) =>
            setSearch(event.target.value)
          }
        />

        <div className="ddag-tag-filter__options">
          {filteredTags.length === 0 ? (
            <div className="ddag-tag-filter__empty">
              No matching tags
            </div>
          ) : (
            filteredTags.map((tag) => (
              <label
                key={tag}
                className="ddag-tag-filter__option"
              >
                <input
                  type="checkbox"
                  checked={selectedTags.includes(
                    tag,
                  )}
                  onChange={() =>
                    onToggle(tag)
                  }
                />

                <span>{tag}</span>
              </label>
            ))
          )}
        </div>

        {selectedTags.length > 0 && (
          <div className="ddag-tag-filter__footer">
            <span>
              {selectedTags.length} selected
            </span>

            <button
              type="button"
              className="ddag-tag-filter__clear"
              onClick={onClear}
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
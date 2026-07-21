import type { Dispatch, RefObject, SetStateAction } from "react";

export type SearchMode = "interest" | "name";

interface SearchModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  sliderStyle: { left: string; width: string };
  containerRef: RefObject<HTMLDivElement | null>;
  interestButtonRef: RefObject<HTMLButtonElement | null>;
  nameButtonRef: RefObject<HTMLButtonElement | null>;
  compact?: boolean;
}

export function SearchModeToggle({
  mode,
  onChange,
  sliderStyle,
  containerRef,
  interestButtonRef,
  nameButtonRef,
  compact = false,
}: SearchModeToggleProps) {
  return (
    <div className="mode-toggle" ref={containerRef} style={compact ? { marginBottom: 0 } : undefined}>
      <div
        className="mode-toggle-slider"
        style={sliderStyle}
      />
      <button
        ref={interestButtonRef}
        onClick={() => onChange("interest")}
        className={`mode-toggle-btn ${mode === "interest" ? "mode-toggle-btn-active" : ""}`}
      >
        By Interest
      </button>
      <button
        ref={nameButtonRef}
        onClick={() => onChange("name")}
        className={`mode-toggle-btn ${mode === "name" ? "mode-toggle-btn-active" : ""}`}
      >
        By Name
      </button>
    </div>
  );
}

interface ResearchSearchFormProps {
  mode: SearchMode;
  hero?: boolean;
  showIcon?: boolean;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  queryTags: string[];
  university: string;
  setUniversity: Dispatch<SetStateAction<string>>;
  universityTags: string[];
  professorName: string;
  setProfessorName: Dispatch<SetStateAction<string>>;
  professorUniversity: string;
  setProfessorUniversity: Dispatch<SetStateAction<string>>;
  defaultPlaceholder: string;
  suggestions: string[];
  showSuggestions: boolean;
  setShowSuggestions: Dispatch<SetStateAction<boolean>>;
  suggestionsRef: RefObject<HTMLDivElement | null>;
  addQueryTag: () => void;
  addUniversityTag: () => void;
  removeQueryTag: (index: number) => void;
  removeUniversityTag: (index: number) => void;
  onInterestSearch: () => void;
  onNameSearch: () => void;
}

function SearchIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, marginLeft: "4px", opacity: 0.85 }}
      aria-hidden="true"
    >
      <circle cx="80" cy="80" r="52" fill="none" stroke="#659983" strokeWidth="7" />
      <path d="M118 118 L155 155" fill="none" stroke="#659983" strokeWidth="8" strokeLinecap="round" />
      <line x1="64" y1="64" x2="96" y2="64" stroke="#c9ad77" strokeWidth="5" strokeLinecap="round" />
      <line x1="64" y1="80" x2="96" y2="80" stroke="#c9ad77" strokeWidth="5" strokeLinecap="round" />
      <line x1="64" y1="96" x2="96" y2="96" stroke="#c9ad77" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function ResearchSearchForm({
  mode,
  hero = false,
  showIcon = false,
  query,
  setQuery,
  queryTags,
  university,
  setUniversity,
  universityTags,
  professorName,
  setProfessorName,
  professorUniversity,
  setProfessorUniversity,
  defaultPlaceholder,
  suggestions,
  showSuggestions,
  setShowSuggestions,
  suggestionsRef,
  addQueryTag,
  addUniversityTag,
  removeQueryTag,
  removeUniversityTag,
  onInterestSearch,
  onNameSearch,
}: ResearchSearchFormProps) {
  const className = `glass-search rm-search${hero ? " rm-hero-search" : ""}`;
  const fieldIdPrefix = hero ? "hero" : "results";

  if (mode === "name") {
    return (
      <div className={className}>
        {showIcon && <SearchIcon />}
        <div className="rm-search-input-wrap">
          <label className="rm-search-label" htmlFor={`${fieldIdPrefix}-professor-name`}>
            Professor Name
          </label>
          <input
            id={`${fieldIdPrefix}-professor-name`}
            value={professorName}
            onChange={(event) => setProfessorName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onNameSearch()}
            placeholder="e.g. Geoffrey Hinton, Fei-Fei Li..."
            className="rm-search-input"
          />
        </div>
        <div className="rm-search-divider" />
        <div className="rm-uni-field">
          <label className="rm-search-label" htmlFor={`${fieldIdPrefix}-professor-university`}>
            University (optional)
          </label>
          <input
            id={`${fieldIdPrefix}-professor-university`}
            value={professorUniversity}
            onChange={(event) => setProfessorUniversity(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onNameSearch()}
            placeholder="Narrows common names"
            className="rm-search-input"
          />
        </div>
        <button onClick={onNameSearch} className="btn-cta rm-search-btn">Search</button>
      </div>
    );
  }

  return (
    <div className={className}>
      {showIcon && <SearchIcon />}
      <div className="rm-search-input-wrap" ref={suggestionsRef} style={{ position: "relative" }}>
        <label className="rm-search-label" htmlFor={`${fieldIdPrefix}-research-interest`}>
          Research Interest
        </label>
        <div className="rm-tag-input-row">
          {queryTags.map((tag, index) => (
            <span key={index} className="rm-tag-chip">
              {tag}
              <button onClick={() => removeQueryTag(index)} className="rm-tag-chip-x">×</button>
            </span>
          ))}
          <input
            id={`${fieldIdPrefix}-research-interest`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setShowSuggestions(false);
                if (query.trim()) addQueryTag();
                else onInterestSearch();
              } else if (event.key === ",") {
                event.preventDefault();
                addQueryTag();
              } else if (event.key === "Backspace" && !query && queryTags.length > 0) {
                removeQueryTag(queryTags.length - 1);
              }
            }}
            placeholder={queryTags.length === 0 ? defaultPlaceholder : "Add another..."}
            className="rm-search-input rm-tag-input"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="suggestions-dropdown">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                className="suggestion-item"
                onClick={() => {
                  setQuery(suggestion);
                  setShowSuggestions(false);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rm-search-divider" />
      <div className="rm-uni-field">
        <label className="rm-search-label" htmlFor={`${fieldIdPrefix}-university`}>
          University
        </label>
        <div className="rm-tag-input-row">
          {universityTags.map((tag, index) => (
            <span key={index} className="rm-tag-chip">
              {tag}
              <button onClick={() => removeUniversityTag(index)} className="rm-tag-chip-x">×</button>
            </span>
          ))}
          <input
            id={`${fieldIdPrefix}-university`}
            value={university}
            onChange={(event) => setUniversity(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (university.trim()) addUniversityTag();
                else onInterestSearch();
              } else if (event.key === ",") {
                event.preventDefault();
                addUniversityTag();
              } else if (event.key === "Backspace" && !university && universityTags.length > 0) {
                removeUniversityTag(universityTags.length - 1);
              }
            }}
            placeholder={universityTags.length === 0 ? "e.g. MIT, Stanford..." : "Add another..."}
            className="rm-search-input rm-tag-input"
          />
        </div>
      </div>
      <button data-search-btn onClick={onInterestSearch} className="btn-cta rm-search-btn">Search</button>
    </div>
  );
}

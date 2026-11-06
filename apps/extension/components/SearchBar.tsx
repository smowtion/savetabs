/**
 * Options search input.
 *
 * Cmd/Ctrl+K focuses the input from anywhere on the page and Escape clears
 * the current query. Filtering itself is synchronous; the parent runs the
 * pure search helper on every keystroke without a debounce.
 */

import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

export type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  inputId?: string;
};

export function SearchBar({
  value,
  onChange,
  label,
  placeholder,
  inputId = "settings-search",
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="relative min-w-[220px] flex-1">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
      />
      <input
        id={inputId}
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-neutral-300 bg-white py-2 ps-9 pe-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
    </div>
  );
}

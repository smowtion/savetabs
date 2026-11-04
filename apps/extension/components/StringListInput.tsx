/**
 * Editable list of strings rendered as removable chips.
 *
 * Entries are added with Enter or a comma, normalized before storage, and
 * validated against the schema's `maxItems`. Empty and duplicate entries are
 * rejected with an inline hint; the stored list is always normalized.
 */

import { X } from "lucide-react";
import { useState } from "react";

export type StringListInputProps = {
  id: string;
  value: readonly string[];
  maxItems: number;
  label: string;
  placeholder: string;
  addLabel: string;
  removeLabel: (item: string) => string;
  emptyMessage: string;
  duplicateMessage: string;
  maxItemsMessage: string;
  disabled?: boolean;
  onChange: (items: string[]) => void;
};

/**
 * Domain-friendly normalization: trim whitespace, lowercase, and drop leading
 * and trailing dots so ".Example.COM." and "example.com" are the same entry.
 */
export function normalizeListItem(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

function normalizeList(items: readonly string[]): string[] {
  return items.map(normalizeListItem).filter((item) => item.length > 0);
}

export function StringListInput({
  id,
  value,
  maxItems,
  label,
  placeholder,
  addLabel,
  removeLabel,
  emptyMessage,
  duplicateMessage,
  maxItemsMessage,
  disabled = false,
  onChange,
}: StringListInputProps) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  function add(): void {
    const candidate = normalizeListItem(draft);
    if (candidate === "") {
      setHint(emptyMessage);
      return;
    }

    const existing = normalizeList(value);
    if (existing.includes(candidate)) {
      setHint(duplicateMessage);
      return;
    }
    if (existing.length >= maxItems) {
      setHint(maxItemsMessage);
      return;
    }

    onChange([...existing, candidate]);
    setDraft("");
    setHint(null);
  }

  function remove(item: string): void {
    const target = normalizeListItem(item);
    onChange(normalizeList(value).filter((entry) => entry !== target));
    setHint(null);
  }

  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {value.length > 0 && (
        <ul
          aria-label={label}
          className="flex max-w-72 flex-wrap justify-end gap-1.5"
        >
          {value.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-2 pr-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              <span>{item}</span>
              <button
                type="button"
                aria-label={removeLabel(item)}
                disabled={disabled}
                onClick={() => remove(item)}
                className="rounded-full p-0.5 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={hint !== null || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (hint !== null) setHint(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            }
          }}
          className="w-48 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={add}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {addLabel}
        </button>
      </div>

      {hint !== null && (
        <p
          role="alert"
          className="max-w-72 text-right text-xs text-red-600 dark:text-red-400"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

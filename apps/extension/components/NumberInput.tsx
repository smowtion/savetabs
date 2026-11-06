/**
 * Number input for bounded integer settings.
 *
 * The draft text is local so the user can clear and retype the value. On blur
 * (or Enter) the draft is validated against `min`/`max` and the step: a valid
 * value is committed, an invalid one is reverted to the stored value and a
 * hint is shown. Invalid drafts are never written to the settings store.
 */

import { useEffect, useState } from "react";

export type NumberInputProps = {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  invalidMessage: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

export function NumberInput({
  id,
  value,
  min,
  max,
  step = 1,
  label,
  invalidMessage,
  disabled = false,
  onChange,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string>(String(value));
  const [invalid, setInvalid] = useState(false);
  const errorId = `${id}-error`;

  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);

  function commit(): void {
    const trimmed = draft.trim();
    const next = trimmed === "" ? Number.NaN : Number(trimmed);

    if (
      !Number.isFinite(next) ||
      !Number.isInteger(next) ||
      next < min ||
      next > max
    ) {
      // Keep the stored value in the field so the control never shows a value
      // that was not saved, and explain why.
      setDraft(String(value));
      setInvalid(true);
      return;
    }

    setDraft(String(next));
    setInvalid(false);
    if (next !== value) onChange(next);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          if (invalid) setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-end text-sm text-neutral-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800"
      />
      {invalid && (
        <p
          id={errorId}
          role="alert"
          className="max-w-56 text-end text-xs text-red-600 dark:text-red-400"
        >
          {invalidMessage}
        </p>
      )}
    </span>
  );
}

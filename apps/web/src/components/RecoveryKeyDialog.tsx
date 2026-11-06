/**
 * One-time recovery key dialog shared by signup and login.
 *
 * The key is the only way to recover the encrypted data, so this modal cannot
 * be dismissed: the user must acknowledge saving it before continuing. Focus
 * starts on the checkbox and Tab wraps between the dialog's controls.
 */

import type { Translator } from "@savetabs/shared";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export type RecoveryKeyDialogProps = {
  recoveryKey: string;
  t: Translator;
  onContinue: () => void;
};

export function RecoveryKeyDialog({
  recoveryKey,
  t,
  onContinue,
}: RecoveryKeyDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    checkboxRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Tab") return;

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR,
    );
    if (focusable === undefined || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t("web.signup.recoveryTitle")}
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {t("web.signup.recoveryMessage")}
        </p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t("web.signup.recoveryKeyLabel")}
        </p>
        <code className="mt-1 block break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
          {recoveryKey}
        </code>

        <label className="mt-4 flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="mt-0.5 size-4 rounded border-neutral-300 accent-indigo-600"
          />
          <span>{t("web.signup.recoveryConfirm")}</span>
        </label>

        <button
          type="button"
          onClick={onContinue}
          disabled={!saved}
          className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("web.signup.continue")}
        </button>
      </div>
    </div>
  );
}

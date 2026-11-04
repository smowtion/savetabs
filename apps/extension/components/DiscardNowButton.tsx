/**
 * "Discard now" action shared by the Memory settings section and the popup.
 *
 * The background owns the discard policy, so the button only sends the typed
 * `DISCARD_NOW` message and renders the outcome. It is disabled when the
 * browser has no `tabs.discard` API, matching the disabled memory settings.
 */

import type { Translator } from "@savetabs/shared";
import { useState } from "react";

import type { DiscardResult } from "../lib/discard";
import {
  sendUiMessage,
  UnexpectedResponseError,
} from "../lib/ui-message-client";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const SMALL_BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

type Status = { kind: "success" | "error"; message: string };

export type DiscardNowButtonProps = {
  t: Translator;
  /** True on browsers without `tabs.discard`. */
  disabled?: boolean;
  /** Compact styling for the popup. */
  compact?: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DiscardNowButton({
  t,
  disabled = false,
  compact = false,
}: DiscardNowButtonProps) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function discardNow(): Promise<void> {
    if (running) return;
    setRunning(true);
    setStatus(null);
    try {
      const response = await sendUiMessage({ type: "DISCARD_NOW" });
      if (!response.ok) {
        setStatus({
          kind: "error",
          message: t("settings.memory.discardNowFailed", {
            message: response.message ?? t("common.error"),
          }),
        });
        return;
      }
      const data = response.data;
      const discarded =
        "discarded" in data ? (data as DiscardResult).discarded : 0;
      setStatus({
        kind: "success",
        message: t("settings.memory.discardNowSuccess", { count: discarded }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.memory.discardNowFailed", {
          message:
            error instanceof UnexpectedResponseError
              ? t("sessions.invalidResponse")
              : errorMessage(error),
        }),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={disabled || running}
        aria-busy={running}
        onClick={() => void discardNow()}
        className={compact ? SMALL_BUTTON_CLASS : BUTTON_CLASS}
      >
        {running ? t("common.loading") : t("settings.memory.discardNow")}
      </button>
      {status !== null && (
        <p
          role={status.kind === "success" ? "status" : "alert"}
          className={`text-xs ${
            status.kind === "success"
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

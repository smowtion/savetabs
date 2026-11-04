/**
 * Import, export, reset and maintenance actions for the Advanced category.
 *
 * All actions are real:
 * - settings export/import round-trip through the shared schema and the
 *   settings store,
 * - session export writes a plaintext recovery file (with a visible warning),
 * - session import merges through the shared rules and persists through the
 *   repository only, reporting quota failures per session,
 * - reset restores settings only, and clearing sessions is a separate,
 *   individually confirmed destructive action.
 *
 * Storage usage comes from `getUsage()` and refreshes whenever the repository
 * announces a change.
 */

import type { Settings, Translator } from "@savetabs/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { exportSessionsFile, importSessionsFile } from "../lib/sessions-export";
import {
  LocalQuotaError,
  addSession,
  deleteSession,
  getUsage,
  listSessions,
  onSessionsChanged,
  updateSession,
  type SessionsUsage,
} from "../lib/sessions-repo";
import { exportSettingsFile, importSettingsFile } from "../lib/settings-export";
import { resetSettings, saveSetting } from "../lib/settings";
import { ConfirmDialog } from "./ConfirmDialog";

export const SETTINGS_EXPORT_FILENAME = "savetabs-settings.json";
export const SESSIONS_EXPORT_FILENAME = "savetabs-sessions.json";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950";

export type AdvancedActionsProps = {
  /** Null until the settings store has loaded; export is then disabled. */
  settings: Settings | null;
  t: Translator;
};

type Status = {
  kind: "success" | "error";
  message: string;
  details?: string[];
};

type Dialog = "reset" | "clear";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read the file"));
    };
    reader.readAsText(file);
  });
}

/** Download a UTF-8 JSON string and release the temporary object URL. */
function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // Firefox only starts a synthetic download for an anchor in the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function AdvancedActions({ settings, t }: AdvancedActionsProps) {
  const [usage, setUsage] = useState<SessionsUsage | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const sessionsInputRef = useRef<HTMLInputElement>(null);

  const refreshUsage = useCallback(async (): Promise<void> => {
    try {
      setUsage(await getUsage());
    } catch (error) {
      console.error("[savetabs] failed to read local usage", error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const next = await getUsage();
        if (active) setUsage(next);
      } catch (error) {
        console.error("[savetabs] failed to read local usage", error);
      }
    };

    void load();
    const unsubscribe = onSessionsChanged(() => {
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function exportSettings(): void {
    if (settings === null) return;
    try {
      downloadJson(SETTINGS_EXPORT_FILENAME, exportSettingsFile(settings));
      setStatus({
        kind: "success",
        message: t("settings.advanced.exportSuccess", {
          filename: SETTINGS_EXPORT_FILENAME,
        }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function importSettings(file: File): Promise<void> {
    try {
      const result = importSettingsFile(await readFileText(file));
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: t("settings.advanced.importSettingsFailed"),
          details: result.errors,
        });
        return;
      }

      // The file was fully validated, so every write below is schema-valid.
      for (const [key, value] of Object.entries(result.settings)) {
        await saveSetting(key, value);
      }
      setStatus({
        kind: "success",
        message: t("settings.advanced.importSettingsSuccess"),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function exportSessions(): Promise<void> {
    try {
      const sessions = await listSessions();
      downloadJson(SESSIONS_EXPORT_FILENAME, exportSessionsFile(sessions));
      setStatus({
        kind: "success",
        message: t("settings.advanced.exportSuccess", {
          filename: SESSIONS_EXPORT_FILENAME,
        }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function importSessions(file: File): Promise<void> {
    try {
      const text = await readFileText(file);
      const existing = await listSessions();
      const result = importSessionsFile(text, existing, Date.now());
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: t("settings.advanced.importSessionsFailed"),
          details: result.errors,
        });
        return;
      }

      const existingById = new Map(
        existing.map((session) => [session.id, session] as const),
      );
      const failures: string[] = [];
      let added = 0;
      let updated = 0;

      for (const session of result.merged) {
        const previous = existingById.get(session.id);
        try {
          if (previous === undefined) {
            await addSession(session);
            added += 1;
          } else if (session.updatedAt > previous.updatedAt) {
            await updateSession(session.id, {
              title: session.title,
              source: session.source,
              tabs: session.tabs,
              updatedAt: session.updatedAt,
              pendingUpload: session.pendingUpload,
              incognito: session.incognito,
            });
            updated += 1;
          }
        } catch (error) {
          if (!(error instanceof LocalQuotaError)) throw error;
          failures.push(`${session.id}: ${error.message}`);
        }
      }

      await refreshUsage();
      setStatus(
        failures.length > 0
          ? {
              kind: "error",
              message: t("settings.advanced.importSessionsPartial", {
                added,
                updated,
              }),
              details: failures,
            }
          : {
              kind: "success",
              message: t("settings.advanced.importSessionsSuccess", {
                added,
                updated,
              }),
            },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function confirmReset(): Promise<void> {
    setDialog(null);
    try {
      await resetSettings();
      setStatus({
        kind: "success",
        message: t("settings.advanced.resetSuccess"),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  async function confirmClear(): Promise<void> {
    setDialog(null);
    try {
      const sessions = await listSessions();
      for (const session of sessions) await deleteSession(session.id);
      await refreshUsage();
      setStatus({
        kind: "success",
        message: t("settings.advanced.clearSuccess"),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.advanced.actionFailed", {
          message: errorMessage(error),
        }),
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {usage === null
            ? t("common.loading")
            : t("settings.advanced.storageUsage", {
                sessions: usage.sessions,
                tabs: usage.tabs,
              })}
        </p>
        {usage?.nearLimit === true && (
          <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
            {t("settings.advanced.storageNearLimit")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={exportSettings}
          disabled={settings === null}
          className={BUTTON_CLASS}
        >
          {t("settings.advanced.exportSettings")}
        </button>
        <button
          type="button"
          onClick={() => settingsInputRef.current?.click()}
          className={BUTTON_CLASS}
        >
          {t("settings.advanced.importSettings")}
        </button>
        <button
          type="button"
          onClick={() => void exportSessions()}
          className={BUTTON_CLASS}
        >
          {t("settings.advanced.exportSessions")}
        </button>
        <button
          type="button"
          onClick={() => sessionsInputRef.current?.click()}
          className={BUTTON_CLASS}
        >
          {t("settings.advanced.importSessions")}
        </button>
        <button
          type="button"
          onClick={() => setDialog("reset")}
          className={BUTTON_CLASS}
        >
          {t("settings.advanced.resetToDefaults")}
        </button>
        <button
          type="button"
          onClick={() => setDialog("clear")}
          className={DANGER_BUTTON_CLASS}
        >
          {t("settings.advanced.clearSessions")}
        </button>
      </div>

      <p className="text-xs text-amber-600 dark:text-amber-400">
        {t("settings.advanced.sessionsPlaintextWarning")}
      </p>

      {status !== null && (
        <div
          role={status.kind === "success" ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-sm ${
            status.kind === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          <p>{status.message}</p>
          {status.details !== undefined && status.details.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {status.details.map((detail, index) => (
                <li key={`${index}-${detail}`}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <input
        ref={settingsInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        data-testid="import-settings-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void importSettings(file);
        }}
      />
      <input
        ref={sessionsInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        data-testid="import-sessions-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void importSessions(file);
        }}
      />

      {dialog === "reset" && (
        <ConfirmDialog
          title={t("settings.advanced.resetTitle")}
          message={t("settings.advanced.resetMessage")}
          confirmLabel={t("settings.advanced.resetConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={() => void confirmReset()}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "clear" && (
        <ConfirmDialog
          title={t("settings.advanced.clearTitle")}
          message={t("settings.advanced.clearMessage")}
          confirmLabel={t("settings.advanced.clearConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={() => void confirmClear()}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

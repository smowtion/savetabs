/**
 * Compact sync control for the toolbar popup.
 *
 * One click enables encrypted sync (after the key is shown once) or runs a
 * full sync. The key is the only credential for the synced data, so the enable
 * panel shows it, offers a copy action and lets the user paste an existing key
 * instead of silently creating a second, empty vault.
 *
 * Settings are written with `saveSettingNow` rather than the debounced store:
 * the popup can close immediately after a click, and a pending debounce would
 * be discarded with the popup's JavaScript context.
 */

import {
  InvalidKeyError,
  SyncAuthError,
  type Settings,
  type Translator,
} from "@savetabs/shared";
import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { copyText } from "../lib/clipboard-write";
import { saveSettingNow } from "../lib/settings";
import {
  SYNC_KEY_STORAGE_KEY,
  getKey,
  getOrCreateKey,
  setKey,
} from "../lib/sync/key-store";
import {
  SYNC_LAST_AT_STORAGE_KEY,
  readLastSyncAt,
  recordSyncCompleted,
} from "../lib/sync/sync-lifecycle";
import { syncNow } from "../lib/sync/sync-service";
import { formatLastSync } from "../lib/sync/sync-time";

const BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50";
const INPUT_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs text-neutral-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

type Feedback = { kind: "success" | "error"; message: string };

export type PopupSyncCardProps = {
  t: Translator;
  settings: Settings | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PopupSyncCard({ t, settings }: PopupSyncCardProps) {
  // undefined while storage loads; null when no key is stored.
  const [keyValue, setKeyValue] = useState<string | null | undefined>(undefined);
  const [lastSyncAt, setLastSyncAt] = useState<number | null | undefined>(
    undefined,
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let active = true;

    const refreshKey = async (): Promise<void> => {
      try {
        const stored = await getKey();
        if (active) setKeyValue(stored ?? null);
      } catch {
        if (active) setKeyValue(null);
      }
    };

    const refreshLastSync = async (): Promise<void> => {
      try {
        const stored = await readLastSyncAt();
        if (active) setLastSyncAt(stored ?? null);
      } catch {
        if (active) setLastSyncAt(null);
      }
    };

    void refreshKey();
    void refreshLastSync();

    const handleStorageChange: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, areaName) => {
      if (areaName !== "local") return;
      if (SYNC_KEY_STORAGE_KEY in changes) void refreshKey();
      if (SYNC_LAST_AT_STORAGE_KEY in changes) void refreshLastSync();
    };
    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      active = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const enabled = settings?.["sync.enabled"] === true;
  const ready = enabled && keyValue !== null && keyValue !== undefined;

  function reportError(error: unknown): void {
    if (error instanceof SyncAuthError) {
      setFeedback({ kind: "error", message: t("settings.sync.authError") });
      return;
    }
    if (error instanceof InvalidKeyError) {
      setFeedback({ kind: "error", message: t("settings.sync.invalidKey") });
      return;
    }
    setFeedback({
      kind: "error",
      message: t("settings.sync.actionFailed", {
        message: errorMessage(error),
      }),
    });
  }

  /** Run one full sync and turn the outcome into a compact message. */
  async function runSync(): Promise<void> {
    try {
      const result = await syncNow();
      await recordSyncCompleted();
      setLastSyncAt(Date.now());
      setFeedback(
        result.errors.length > 0
          ? {
              kind: "error",
              message: t("popup.syncErrors", {
                count: result.errors.length,
                message: result.errors[0],
              }),
            }
          : {
              kind: "success",
              message: t("settings.sync.syncResult", {
                uploaded: result.uploaded,
                downloaded: result.downloaded,
                deleted: result.deleted,
              }),
            },
      );
    } catch (error) {
      reportError(error);
    }
  }

  /** Prefer a pasted key; otherwise reuse or create the local one. */
  async function resolveKey(): Promise<string> {
    const pasted = importValue.trim();
    if (pasted !== "") return setKey(pasted, "upload");
    if (keyValue !== null && keyValue !== undefined) return keyValue;
    return getOrCreateKey();
  }

  async function openPanel(): Promise<void> {
    setFeedback(null);
    setPanelOpen(true);
    if (keyValue !== null && keyValue !== undefined) return;
    try {
      setKeyValue(await getOrCreateKey());
    } catch (error) {
      reportError(error);
    }
  }

  async function copyKey(): Promise<void> {
    if (keyValue === null || keyValue === undefined) return;
    try {
      await copyText(keyValue);
      setFeedback({
        kind: "success",
        message: t("settings.sync.copied"),
      });
    } catch {
      setFeedback({
        kind: "error",
        message: t("settings.sync.copyFailed"),
      });
    }
  }

  async function enableAndSync(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setFeedback(null);
    try {
      setKeyValue(await resolveKey());
      await saveSettingNow("sync.enabled", true);
      setPanelOpen(false);
      setImportValue("");
      await runSync();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }

  async function syncNowClick(): Promise<void> {
    if (busy || !ready) return;

    setBusy(true);
    setFeedback(null);
    try {
      await runSync();
    } finally {
      setBusy(false);
    }
  }

  const lastSyncLabel = !ready
    ? t("popup.syncOffHint")
    : lastSyncAt === undefined
      ? t("common.loading")
      : lastSyncAt === null
        ? t("settings.sync.neverSynced")
        : t("popup.syncLast", {
            time: formatLastSync(lastSyncAt, Date.now(), t),
          });

  return (
    <section
      aria-label={t("settings.sync.statusTitle")}
      className="rounded-lg border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-xs font-semibold ${
              ready
                ? "text-green-700 dark:text-green-400"
                : "text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {ready ? t("popup.syncOn") : t("popup.syncOff")}
          </p>
          <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {lastSyncLabel}
          </p>
        </div>

        {ready ? (
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            title={busy ? t("settings.sync.syncing") : t("common.syncNow")}
            onClick={() => void syncNowClick()}
            className={BUTTON_CLASS}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            />
            {busy ? t("settings.sync.syncing") : t("common.syncNow")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void openPanel()}
            className={PRIMARY_BUTTON_CLASS}
          >
            <CloudOff aria-hidden="true" className="h-3.5 w-3.5" />
            {t("popup.syncEnable")}
          </button>
        )}
      </div>

      {panelOpen && !ready && (
        <div className="mt-2 flex flex-col gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          <p className="text-xs font-semibold">{t("popup.syncPanelTitle")}</p>

          <div>
            <p className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
              {t("popup.syncKeyLabel")}
            </p>
            <div className="mt-1 flex items-start gap-1.5">
              <code className="min-w-0 flex-1 break-all rounded-md bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">
                {keyValue === undefined
                  ? t("common.loading")
                  : keyValue === null
                    ? "—"
                    : keyValue}
              </code>
              <button
                type="button"
                disabled={keyValue === null || keyValue === undefined}
                onClick={() => void copyKey()}
                className={BUTTON_CLASS}
              >
                {t("settings.sync.copyKey")}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {t("settings.sync.loseKeyWarning")}
            </p>
          </div>

          <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            {t("settings.sync.importLabel")}
            <input
              type="text"
              value={importValue}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("settings.sync.importPlaceholder")}
              onChange={(event) => {
                setImportValue(event.target.value);
                if (feedback?.kind === "error") setFeedback(null);
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void enableAndSync()}
              className={PRIMARY_BUTTON_CLASS}
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
              />
              {busy
                ? t("settings.sync.syncing")
                : t("popup.syncEnableConfirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPanelOpen(false);
                setImportValue("");
                setFeedback(null);
              }}
              className={BUTTON_CLASS}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {feedback !== null && (
        <p
          role={feedback.kind === "success" ? "status" : "alert"}
          className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] ${
            feedback.kind === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}

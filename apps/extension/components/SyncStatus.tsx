/**
 * Sync status panel for the options page.
 *
 * Shows whether encrypted sync is enabled, when the last full sync finished,
 * how many sessions are waiting to be uploaded, and the counters/errors from
 * the most recent manual run. "Sync now" calls the sync service directly; a
 * rejected key is rendered as a distinct alert instead of an empty success.
 *
 * "Delete cloud data" is destructive and always confirmed. It removes only
 * the server-side rows for the current key: local sessions, their
 * `syncExcluded` flags and the key itself stay untouched.
 */

import { SyncAuthError, type Translator } from "@savetabs/shared";
import { useCallback, useEffect, useState } from "react";

import { listSessions, onSessionsChanged } from "../lib/sessions-repo";
import {
  deleteAllCloudData,
  readLastSyncAt,
  recordSyncCompleted,
} from "../lib/sync/sync-lifecycle";
import { syncNow, type SyncResult } from "../lib/sync/sync-service";
import { ConfirmDialog } from "./ConfirmDialog";

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Feedback = {
  kind: "success" | "error";
  message: string;
};

export type SyncStatusProps = {
  t: Translator;
  /** Whether `sync.enabled` is on; manual sync is disabled while it is off. */
  enabled: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Relative label for `syncLastAt`, reusing the sessions-page time strings. */
export function formatLastSync(
  timestamp: number,
  now: number,
  t: Translator,
): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return t("sessions.time.justNow");
  if (elapsed < HOUR_MS) {
    return t("sessions.time.minutesAgo", {
      count: Math.floor(elapsed / MINUTE_MS),
    });
  }
  if (elapsed < DAY_MS) {
    return t("sessions.time.hoursAgo", {
      count: Math.floor(elapsed / HOUR_MS),
    });
  }
  return t("sessions.time.daysAgo", { count: Math.floor(elapsed / DAY_MS) });
}

async function countPendingUploads(): Promise<number> {
  const sessions = await listSessions();
  return sessions.filter((session) => session.pendingUpload === true).length;
}

export function SyncStatus({ t, enabled }: SyncStatusProps) {
  // undefined while the stored value loads; null when no sync has happened.
  const [lastSyncAt, setLastSyncAt] = useState<number | null | undefined>(
    undefined,
  );
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [authError, setAuthError] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<Feedback | null>(null);

  const refreshPendingCount = useCallback(async (): Promise<void> => {
    try {
      setPendingCount(await countPendingUploads());
    } catch (error) {
      console.error("[savetabs] failed to count pending sync uploads", error);
      setPendingCount(0);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void readLastSyncAt()
      .then((stored) => {
        if (active) setLastSyncAt(stored ?? null);
      })
      .catch(() => {
        if (active) setLastSyncAt(null);
      });
    void refreshPendingCount();

    const unsubscribe = onSessionsChanged(() => {
      void refreshPendingCount();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshPendingCount]);

  async function handleSyncNow(): Promise<void> {
    if (running || !enabled) return;

    setRunning(true);
    setAuthError(false);
    setResult(null);
    try {
      const next = await syncNow();
      setResult(next);
      await recordSyncCompleted();
      setLastSyncAt(Date.now());
    } catch (error) {
      if (error instanceof SyncAuthError) {
        // A rejected key must never look like a successful empty sync.
        setAuthError(true);
      } else {
        setResult({
          uploaded: 0,
          downloaded: 0,
          deleted: 0,
          errors: [errorMessage(error)],
        });
      }
    } finally {
      setRunning(false);
      await refreshPendingCount();
    }
  }

  async function confirmDeleteCloudData(): Promise<void> {
    setDeleteConfirmOpen(false);
    setDeleting(true);
    setDeleteStatus(null);
    try {
      await deleteAllCloudData();
      setDeleteStatus({
        kind: "success",
        message: t("settings.sync.deleteCloudSuccess"),
      });
    } catch (error) {
      setDeleteStatus({
        kind: "error",
        message:
          error instanceof SyncAuthError
            ? t("settings.sync.authError")
            : t("settings.sync.actionFailed", {
                message: errorMessage(error),
              }),
      });
    } finally {
      setDeleting(false);
    }
  }

  const lastSyncLabel =
    lastSyncAt === undefined
      ? t("common.loading")
      : lastSyncAt === null
        ? t("settings.sync.neverSynced")
        : formatLastSync(lastSyncAt, Date.now(), t);

  return (
    <section
      aria-label={t("settings.sync.statusTitle")}
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-semibold">
        {t("settings.sync.statusTitle")}
      </h3>

      <p
        role="status"
        aria-live="polite"
        data-testid="sync-state"
        className={`text-sm ${
          enabled
            ? "text-green-600 dark:text-green-400"
            : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {enabled ? t("settings.sync.statusOn") : t("settings.sync.statusOff")}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-neutral-500 dark:text-neutral-400">
          {t("settings.sync.lastSyncLabel")}
        </dt>
        <dd data-testid="sync-last-at">{lastSyncLabel}</dd>
        <dt className="text-neutral-500 dark:text-neutral-400">
          {t("settings.sync.pendingLabel")}
        </dt>
        <dd data-testid="sync-pending-count">
          {pendingCount === null ? t("common.loading") : pendingCount}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={running || !enabled}
          aria-busy={running}
          onClick={() => void handleSyncNow()}
          className={PRIMARY_BUTTON_CLASS}
        >
          {running ? t("settings.sync.syncing") : t("common.syncNow")}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={() => setDeleteConfirmOpen(true)}
          className={DANGER_BUTTON_CLASS}
        >
          {t("settings.sync.deleteCloud")}
        </button>
      </div>

      {authError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {t("settings.sync.authError")}
        </div>
      )}

      {result !== null && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p>
            {t("settings.sync.syncResult", {
              uploaded: result.uploaded,
              downloaded: result.downloaded,
              deleted: result.deleted,
            })}
          </p>
          {result.errors.length > 0 && (
            <div className="mt-1">
              <p className="font-medium">
                {t("settings.sync.syncErrorsTitle")}
              </p>
              <ul
                aria-label={t("settings.sync.syncErrorsTitle")}
                className="mt-1 list-disc ps-5"
              >
                {result.errors.map((error, index) => (
                  <li key={`${index}-${error}`}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {deleteStatus !== null && (
        <div
          role={deleteStatus.kind === "success" ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-sm ${
            deleteStatus.kind === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {deleteStatus.message}
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={t("settings.sync.deleteCloudTitle")}
          message={t("settings.sync.deleteCloudMessage")}
          confirmLabel={t("settings.sync.deleteCloudConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={() => void confirmDeleteCloudData()}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </section>
  );
}

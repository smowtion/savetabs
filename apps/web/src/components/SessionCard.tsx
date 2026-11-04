/**
 * One decrypted session on the web sessions page.
 *
 * The header shows the session name or its timestamp, the tab count and the
 * actions. Restore opens every tab in a new browser tab on the user's click
 * (browsers may block pop-ups, so the page explains that next to the list).
 * Copy and export are local: copy uses plain URLs because the web app has no
 * extension settings, and export writes the standard single-session envelope.
 * Delete is routed through the modal `ConfirmDialog`.
 *
 * The body renders every tab with its title and domain. Restorable URLs are
 * real links, keyboard navigable and opening in a new tab without an opener;
 * any other scheme is rendered as plain text so it can never be clicked.
 */

import {
  isRestorableUrl,
  type Lang,
  type SavedTab,
  type Session,
  type Translator,
} from "@savetabs/shared";
import { useId, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

export type SessionCardProps = {
  session: Session;
  lang: Lang;
  t: Translator;
  /** Delete through the sessions page after confirmation. */
  onDelete: (sessionId: string) => void | Promise<void>;
  /** Show a page-level success or error message. */
  onNotify: (kind: "success" | "error", message: string) => void;
};

const SESSIONS_FILE_APP = "savetabs";
const SESSIONS_FILE_KIND = "sessions";
const SESSIONS_FILE_VERSION = 1;

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-400 dark:hover:bg-red-950";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Hostname for a saved URL; malformed URLs fall back to their raw value. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Visible label for one saved tab. */
function tabLabel(tab: SavedTab): string {
  return tab.title.trim() !== "" ? tab.title : tab.url;
}

/** Filename used when one session is exported as JSON. */
function sessionExportFilename(session: Session): string {
  const safeId =
    session.id.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "session";
  return `savetabs-session-${safeId}.json`;
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
  // Revoking synchronously can abort the download in some browsers; let the
  // click be processed first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SessionCard({
  session,
  lang,
  t,
  onDelete,
  onNotify,
}: SessionCardProps) {
  const titleId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  const customTitle = session.title?.trim() ?? "";
  const dateTime = new Date(session.createdAt).toISOString();
  const timeLabel = new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(session.createdAt));
  const hasTabs = session.tabs.length > 0;

  async function copyTabs(): Promise<void> {
    setCopying(true);
    try {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined || typeof clipboard.writeText !== "function") {
        throw new Error("Clipboard is unavailable");
      }
      await clipboard.writeText(
        session.tabs.map((tab) => tab.url).join("\n"),
      );
      onNotify("success", t("web.sessions.copySuccess", {
        count: session.tabs.length,
      }));
    } catch {
      onNotify("error", t("web.sessions.copyFailed"));
    } finally {
      setCopying(false);
    }
  }

  function restoreTabs(): void {
    let opened = 0;
    let blocked = 0;

    for (const tab of session.tabs) {
      if (!isRestorableUrl(tab.url)) continue;
      const openedWindow = window.open(tab.url, "_blank");
      if (openedWindow === null) {
        blocked += 1;
        continue;
      }
      // Drop the reference back to this page as a defensive noopener.
      openedWindow.opener = null;
      opened += 1;
    }

    if (blocked > 0) {
      onNotify("error", t("web.sessions.popupBlocked", { count: blocked }));
    } else {
      onNotify("success", t("web.sessions.restoreSuccess", { count: opened }));
    }
  }

  function exportSession(): void {
    try {
      const filename = sessionExportFilename(session);
      const file = {
        app: SESSIONS_FILE_APP,
        kind: SESSIONS_FILE_KIND,
        version: SESSIONS_FILE_VERSION,
        exportedAt: new Date().toISOString(),
        sessions: [session],
      };
      downloadJson(filename, JSON.stringify(file, null, 2));
      onNotify("success", t("web.sessions.exportSuccess", { filename }));
    } catch (error) {
      onNotify("error", t("web.sessions.exportFailed", {
        message: errorMessage(error),
      }));
    }
  }

  function confirmDelete(): void {
    setConfirmOpen(false);
    void onDelete(session.id);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="min-w-0 break-words text-base font-semibold"
          >
            {customTitle !== "" ? (
              customTitle
            ) : (
              <time dateTime={dateTime}>{timeLabel}</time>
            )}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            {customTitle !== "" ? (
              <time dateTime={dateTime}>{timeLabel}</time>
            ) : null}
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {t("common.tabsCount", { count: session.tabs.length })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={restoreTabs}
            disabled={!hasTabs}
            className={BUTTON_CLASS}
          >
            {t("web.sessions.restore")}
          </button>
          <button
            type="button"
            onClick={() => void copyTabs()}
            disabled={!hasTabs || copying}
            className={BUTTON_CLASS}
          >
            {t("web.sessions.copy")}
          </button>
          <button
            type="button"
            onClick={exportSession}
            className={PRIMARY_BUTTON_CLASS}
          >
            {t("web.sessions.export")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className={DANGER_BUTTON_CLASS}
          >
            {t("web.sessions.delete")}
          </button>
        </div>
      </div>

      {hasTabs ? (
        <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {session.tabs.map((tab, index) => {
            const label = (
              <>
                <span className="truncate font-medium">{tabLabel(tab)}</span>
                <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {hostnameOf(tab.url)}
                </span>
              </>
            );

            return (
              <li key={`${index}-${tab.url}`} className="min-w-0">
                {isRestorableUrl(tab.url) ? (
                  <a
                    href={tab.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tab.url}
                    className="flex min-w-0 flex-col rounded-md px-2 py-1.5 text-sm text-indigo-700 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
                  >
                    {label}
                  </a>
                ) : (
                  <span
                    title={tab.url}
                    className="flex min-w-0 flex-col rounded-md px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400"
                  >
                    {label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          {t("web.sessions.noTabs")}
        </p>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title={t("web.sessions.deleteTitle")}
          message={t("web.sessions.deleteMessage")}
          confirmLabel={t("web.sessions.deleteConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}

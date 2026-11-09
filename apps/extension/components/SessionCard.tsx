/**
 * One saved session on the sessions page (card layout A).
 *
 * The header shows the session name or its relative timestamp, an optional
 * tab-count badge and the primary actions. Restore and delete delegate to the
 * page, which talks to the background service worker; copy and export are
 * local to the card. Destructive deletion goes through the shared
 * `ConfirmDialog`.
 *
 * The body renders every tab as a real link. Links stay keyboard navigable,
 * the visible label follows `urlDisplay.mode`, and one read-only text area
 * lists every URL on its own line, so a truncated label can never hide or
 * lose the real destination.
 */

import {
  formatTabsForClipboard,
  type ClipboardFormat,
  type Lang,
  type SavedTab,
  type Session,
  type Translator,
} from "@savetabs/shared";
import { MoreHorizontal } from "lucide-react";
import {
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { copyText } from "../lib/clipboard-write";
import { exportSessionsFile } from "../lib/sessions-export";
import { updateSession } from "../lib/sessions-repo";
import { formatSessionTime } from "../lib/session-time";
import { ConfirmDialog } from "./ConfirmDialog";

/** How tab labels are rendered; mirrors the `urlDisplay.mode` setting. */
export type UrlDisplayMode = "title" | "domain" | "full-url";

export type SessionCardProps = {
  session: Session;
  expanded: boolean;
  onToggleExpanded: () => void;
  displayMode: UrlDisplayMode;
  showFavicons: boolean;
  showTabCount: boolean;
  clipboardFormat: ClipboardFormat;
  lang: Lang;
  t: Translator;
  /** Restore through the background service worker. */
  onRestore: () => void | Promise<void>;
  /** Delete through the background service worker after confirmation. */
  onDelete: () => void | Promise<void>;
  /** Called after a local mutation (rename) so the page can refresh. */
  onChanged: () => void;
  /** Show a page-level success or error message. */
  onNotify: (kind: "success" | "error", message: string) => void;
};

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50";
const ICON_BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white p-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

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

/** Visible label for one saved tab under the configured display mode. */
function tabLabel(tab: SavedTab, mode: UrlDisplayMode): string {
  switch (mode) {
    case "domain":
      return hostnameOf(tab.url);
    case "full-url":
      return tab.url;
    case "title":
      return tab.title.trim() !== "" ? tab.title : tab.url;
  }
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
  URL.revokeObjectURL(url);
}

export function SessionCard({
  session,
  expanded,
  onToggleExpanded,
  displayMode,
  showFavicons,
  showTabCount,
  clipboardFormat,
  lang,
  t,
  onRestore,
  onDelete,
  onChanged,
  onNotify,
}: SessionCardProps) {
  const bodyId = useId();
  const renameInputId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  const time = formatSessionTime(session.createdAt, Date.now(), lang, t);
  const customTitle = session.title?.trim() ?? "";
  const cardLabel = customTitle !== "" ? customTitle : time.relative;
  const dateTime = new Date(session.createdAt).toISOString();

  function beginRename(): void {
    setMenuOpen(false);
    setRenameValue(customTitle);
    setRenaming(true);
  }

  function cancelRename(): void {
    setRenaming(false);
    setRenameValue("");
  }

  async function submitRename(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (renameBusy) return;

    setRenameBusy(true);
    try {
      const nextTitle = renameValue.trim();
      const updated = await updateSession(session.id, {
        title: nextTitle === "" ? undefined : nextTitle,
      });
      if (updated === undefined) {
        onNotify("error", t("sessions.sessionMissing"));
        return;
      }
      setRenaming(false);
      setRenameValue("");
      onNotify("success", t("sessions.renameSuccess"));
      onChanged();
    } catch (error) {
      onNotify("error", t("sessions.actionFailed", {
        message: errorMessage(error),
      }));
    } finally {
      setRenameBusy(false);
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  async function copyTabs(): Promise<void> {
    setCopying(true);
    try {
      await copyText(formatTabsForClipboard(session.tabs, clipboardFormat));
      onNotify("success", t("sessions.copySuccess", {
        count: session.tabs.length,
      }));
    } catch {
      onNotify("error", t("sessions.copyFailed"));
    } finally {
      setCopying(false);
    }
  }

  function exportSession(): void {
    setMenuOpen(false);
    try {
      const filename = sessionExportFilename(session);
      downloadJson(filename, exportSessionsFile([session]));
      onNotify("success", t("sessions.exportSuccess", { filename }));
    } catch (error) {
      onNotify("error", t("sessions.actionFailed", {
        message: errorMessage(error),
      }));
    }
  }

  function requestDelete(): void {
    setMenuOpen(false);
    setDeleteConfirmOpen(true);
  }

  function confirmDelete(): void {
    setDeleteConfirmOpen(false);
    void onDelete();
  }

  return (
    <section
      aria-label={cardLabel}
      className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={(event) => void submitRename(event)}
              className="flex flex-wrap items-center gap-2"
            >
              <label htmlFor={renameInputId} className="sr-only">
                {t("sessions.renameLabel")}
              </label>
              <input
                id={renameInputId}
                type="text"
                value={renameValue}
                autoFocus
                disabled={renameBusy}
                autoComplete="off"
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                type="submit"
                disabled={renameBusy}
                className={PRIMARY_BUTTON_CLASS}
              >
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={cancelRename}
                className={BUTTON_CLASS}
              >
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className="min-w-0 break-words">{cardLabel}</span>
              {session.incognito === true && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {t("sessions.private")}
                </span>
              )}
            </h2>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <time dateTime={dateTime} title={time.absolute}>
              {customTitle !== "" ? time.relative : time.absolute}
            </time>
            {showTabCount && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {t("common.tabsCount", { count: session.tabs.length })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onRestore()}
            className={BUTTON_CLASS}
          >
            {t("common.restore")}
          </button>
          <button
            type="button"
            onClick={() => void copyTabs()}
            disabled={copying}
            className={BUTTON_CLASS}
          >
            {t("common.copy")}
          </button>
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("sessions.moreActions")}
              onClick={() => setMenuOpen((current) => !current)}
              className={ICON_BUTTON_CLASS}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label={t("sessions.moreActions")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMenuOpen(false);
                  }
                }}
                className="absolute end-0 z-20 mt-1 flex w-48 flex-col rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={beginRename}
                  className="rounded px-2 py-1.5 text-start text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("sessions.rename")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={exportSession}
                  className="rounded px-2 py-1.5 text-start text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("sessions.exportSession")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={requestDelete}
                  className="rounded px-2 py-1.5 text-start text-sm text-red-700 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {t("common.delete")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggleExpanded}
        className="mt-3 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
      >
        {expanded ? t("sessions.collapse") : t("sessions.expand")}
      </button>

      {expanded && (
        <div id={bodyId} className="mt-2">
          {session.tabs.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("sessions.noTabs")}
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-x-4 gap-y-1 min-[900px]:grid-cols-2">
              {session.tabs.map((tab, index) => (
                <li key={`${index}-${tab.url}`} className="min-w-0">
                  <a
                    href={tab.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={tab.url}
                    className="flex min-w-0 items-center gap-2 text-sm text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {showFavicons &&
                      typeof tab.favIconUrl === "string" &&
                      tab.favIconUrl !== "" && (
                        <img
                          src={tab.favIconUrl}
                          alt=""
                          loading="lazy"
                          className="h-4 w-4 shrink-0"
                        />
                      )}
                    <span className="truncate">
                      {tabLabel(tab, displayMode)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <label className="mt-3 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              {t("sessions.allUrls")}
              <textarea
                readOnly
                dir="ltr"
                rows={Math.min(Math.max(session.tabs.length, 2), 8)}
                value={session.tabs.map((tab) => tab.url).join("\n")}
                onFocus={(event) => event.currentTarget.select()}
                onClick={(event) => event.currentTarget.select()}
                className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-[11px] leading-5 text-neutral-600 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400"
              />
            </label>
            </>
          )}
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={t("sessions.deleteTitle")}
          message={t("sessions.deleteMessage")}
          confirmLabel={t("sessions.deleteConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * Compact toolbar popup (360x420).
 *
 * The popup is a thin overview of what a save would cover: it shows how many
 * tabs the save would store, the most recent sessions, the auto-discard state
 * and a compact sync card. It also exposes the two controls that should not
 * require opening Options: the display-language picker and the one-click
 * enable/sync action. Every other setting lives in Options and is only read
 * here.
 *
 * The save button asks the background service worker through the typed
 * message contract. When the background answers `confirmation_required`,
 * nothing has been saved or closed yet, so the popup shows the shared
 * `ConfirmDialog` and only then resends `SAVE_TABS` with `confirmed: true`.
 *
 * The count is never a raw tab count: it resolves the same save scope as the
 * background (current window, or every normal window when
 * `tabs.saveAllWindows` is on) and runs the same `collectTabsForSave` filters
 * (scheme, pinned, audible, excluded domains and duplicate rules against every
 * stored session) over it.
 */

import {
  APP_NAME,
  isLanguagePreference,
  type LanguagePreference,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DiscardNowButton } from "../../components/DiscardNowButton";
import { LanguageSelect } from "../../components/LanguageSelect";
import { PopupSyncCard } from "../../components/PopupSyncCard";
import { UpdateBanner } from "../../components/UpdateBanner";
import { useI18n } from "../../hooks/useI18n";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  DISCARD_STATS_KEY,
  getDiscardStats,
  isDiscardSupported,
} from "../../lib/discard";
import type { UiResponse } from "../../lib/messages";
import type { RestoreResult } from "../../lib/restore";
import type { SaveTabsResult } from "../../lib/save-flow";
import { queryTabsForSaveScope } from "../../lib/save-scope";
import { formatSessionTime } from "../../lib/session-time";
import { listSessions, onSessionsChanged } from "../../lib/sessions-repo";
import { saveSettingNow } from "../../lib/settings";
import { collectTabsForSave } from "../../lib/tab-collector";
import { normalizeThemePreference } from "../../lib/theme";
import {
  sendUiMessage,
  UnexpectedResponseError,
} from "../../lib/ui-message-client";

type Status = { kind: "success" | "error"; message: string };
type ErrorResponse = Extract<UiResponse, { ok: false }>;

const TOOLBAR_ACTIONS = ["popup", "save", "sessions"] as const;
type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

/** Sessions shown under "Recent sessions". */
const MAX_RECENT_SESSIONS = 3;
/** Fallback for an incomplete settings snapshot. */
const DEFAULT_TIMEOUT_MINUTES = 30;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The configured idle timeout, or the schema default. */
function readTimeoutMinutes(settings: Settings): number {
  const value = settings["memory.timeoutMinutes"];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_MINUTES;
}

export function App() {
  const { settings } = useSettings();
  const { lang, t } = useI18n(settings?.["general.language"]);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [tabCount, setTabCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveConfirmCount, setSaveConfirmCount] = useState<number | null>(null);
  const [discardCount, setDiscardCount] = useState(0);
  const discardSupported = isDiscardSupported();

  const themePreference = normalizeThemePreference(settings?.["general.theme"]);
  useTheme(themePreference);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = APP_NAME;
  }, [lang]);

  // Settings, stored sessions and open tabs all influence the save count.
  // Refresh on every relevant change while the popup stays open, and detach
  // the listeners when it closes.
  useEffect(() => {
    if (settings === null) return;
    let active = true;

    const refresh = async (): Promise<void> => {
      try {
        const [tabs, existingSessions] = await Promise.all([
          queryTabsForSaveScope("window", settings),
          listSessions(),
        ]);
        if (!active) return;
        setSessions(existingSessions);
        setTabCount(
          collectTabsForSave(tabs, {
            settings,
            existingSessions,
          }).tabs.length,
        );
      } catch (error) {
        console.error("[savetabs] failed to load the popup data", error);
        if (!active) return;
        setSessions([]);
        setTabCount(0);
        setStatus({ kind: "error", message: t("popup.loadFailed") });
      }
    };

    void refresh();
    const unsubscribeSessions = onSessionsChanged(() => {
      void refresh();
    });
    const handleTabsChanged = (): void => {
      void refresh();
    };
    browser.tabs.onCreated.addListener(handleTabsChanged);
    browser.tabs.onRemoved.addListener(handleTabsChanged);
    browser.tabs.onUpdated.addListener(handleTabsChanged);

    return () => {
      active = false;
      unsubscribeSessions();
      browser.tabs.onCreated.removeListener(handleTabsChanged);
      browser.tabs.onRemoved.removeListener(handleTabsChanged);
      browser.tabs.onUpdated.removeListener(handleTabsChanged);
    };
  }, [settings, t]);

  // Today's discard counter is written by the background sweep.
  useEffect(() => {
    if (!discardSupported) return;
    let active = true;

    const refresh = async (): Promise<void> => {
      const stats = await getDiscardStats();
      if (active) setDiscardCount(stats.count);
    };

    void refresh();
    const handleStorageChange: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!(DISCARD_STATS_KEY in changes)) return;
      void refresh();
    };
    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      active = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [discardSupported]);

  function responseError(response: ErrorResponse): string {
    if (response.code === "not_found") return t("sessions.sessionMissing");
    if (response.message !== undefined && response.message !== "") {
      return t("sessions.actionFailed", { message: response.message });
    }
    return t("common.error");
  }

  function reportException(error: unknown): void {
    setStatus({
      kind: "error",
      message:
        error instanceof UnexpectedResponseError
          ? t("sessions.invalidResponse")
          : t("sessions.actionFailed", { message: errorMessage(error) }),
    });
  }

  async function saveWindow(confirmed = false): Promise<void> {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await sendUiMessage({
        type: "SAVE_TABS",
        source: "window",
        ...(confirmed ? { confirmed: true } : {}),
      });
      if (!response.ok) {
        // The background declined without writing or closing anything. Ask
        // the user before retrying with the confirmed flag.
        if (response.code === "confirmation_required") {
          setSaveConfirmCount(response.data?.count ?? 0);
          return;
        }
        setStatus({ kind: "error", message: responseError(response) });
        return;
      }
      const data = response.data;
      const savedTabs =
        "session" in data
          ? (data as SaveTabsResult).session?.tabs.length ?? 0
          : 0;
      const overflow =
        "overflow" in data ? (data as SaveTabsResult).overflow : 0;
      setStatus({
        kind: "success",
        message:
          savedTabs > 0
            ? overflow > 0
              ? t("sessions.saveOverflow", { saved: savedTabs, overflow })
              : t("sessions.saveSuccess", { count: savedTabs })
            : t("sessions.saveEmpty"),
      });
    } catch (error) {
      reportException(error);
    } finally {
      setSaving(false);
    }
  }

  function confirmSaveWindow(): void {
    setSaveConfirmCount(null);
    void saveWindow(true);
  }

  function cancelSaveWindow(): void {
    setSaveConfirmCount(null);
  }

  async function restoreSession(sessionId: string): Promise<void> {
    setStatus(null);
    try {
      const response = await sendUiMessage({
        type: "RESTORE_SESSION",
        sessionId,
      });
      if (!response.ok) {
        setStatus({ kind: "error", message: responseError(response) });
        return;
      }
      const data = response.data;
      const opened = "opened" in data ? (data as RestoreResult).opened : 0;
      setStatus({
        kind: "success",
        message: t("sessions.restoreSuccess", { count: opened }),
      });
    } catch (error) {
      reportException(error);
    }
  }

  async function openSessionsPage(): Promise<void> {
    try {
      await browser.tabs.create({
        url: browser.runtime.getURL("/sessions.html"),
      });
    } catch (error) {
      console.error("[savetabs] failed to open the sessions page", error);
      setStatus({ kind: "error", message: t("common.error") });
    }
  }

  async function openSettingsPage(): Promise<void> {
    try {
      await browser.runtime.openOptionsPage();
    } catch (error) {
      console.error("[savetabs] failed to open the options page", error);
      setStatus({ kind: "error", message: t("common.error") });
    }
  }

  /**
   * Persist immediately: the popup can close right after the selection and a
   * debounced write would be lost with the popup's context.
   */
  function changeLanguage(value: LanguagePreference): void {
    void saveSettingNow("general.language", value).catch((error) => {
      console.error("[savetabs] failed to save the language", error);
    });
  }

  function changeToolbarAction(value: ToolbarAction): void {
    void saveSettingNow("open.toolbarAction", value).catch((error) => {
      console.error("[savetabs] failed to save the toolbar action", error);
    });
  }

  const storedToolbarAction = settings?.["open.toolbarAction"];
  const toolbarAction: ToolbarAction =
    storedToolbarAction === "save" || storedToolbarAction === "sessions"
      ? storedToolbarAction
      : "popup";

  const storedLanguage = settings?.["general.language"];
  const languagePreference = isLanguagePreference(storedLanguage)
    ? storedLanguage
    : "auto";

  const autoDiscardText =
    settings === null || !discardSupported
      ? null
      : settings["memory.autoDiscard"] === true
        ? t("popup.discardStatus", {
            minutes: readTimeoutMinutes(settings),
            count: discardCount,
          })
        : t("popup.discardOff");

  const recent =
    sessions === null ? [] : sessions.slice(0, MAX_RECENT_SESSIONS);
  const now = Date.now();

  return (
    <div className="flex h-full w-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={browser.runtime.getURL("/icon/icon-32.png")}
            alt=""
            className="h-6 w-6 shrink-0"
          />
          <h1 className="truncate text-base font-semibold">{APP_NAME}</h1>
        </div>
        <LanguageSelect
          value={languagePreference}
          onChange={changeLanguage}
          t={t}
        />
      </header>

      <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <UpdateBanner t={t} />

        <PopupSyncCard t={t} settings={settings} />

        <button
          type="button"
          onClick={() => void saveWindow()}
          disabled={saving || tabCount === null}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {tabCount === null
            ? t("common.loading")
            : t("popup.saveTabs", { count: tabCount })}
        </button>

        <button
          type="button"
          onClick={() => void openSessionsPage()}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("popup.openSessions")}
        </button>

        {discardSupported && (
          <div className="flex flex-col gap-1.5">
            {autoDiscardText !== null && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {autoDiscardText}
              </p>
            )}
            <DiscardNowButton t={t} compact />
          </div>
        )}

        {status !== null && (
          <p
            role={status.kind === "success" ? "status" : "alert"}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${
              status.kind === "success"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {status.message}
          </p>
        )}

        <section
          aria-labelledby="popup-recent-heading"
          className="flex flex-col gap-1.5"
        >
          <h2
            id="popup-recent-heading"
            className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
          >
            {t("popup.recentTitle")}
          </h2>

          {sessions === null ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t("common.loading")}
            </p>
          ) : recent.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {t("popup.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recent.map((session) => {
                const time = formatSessionTime(
                  session.createdAt,
                  now,
                  lang,
                  t,
                );
                return (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="min-w-0">
                      <time
                        dateTime={new Date(session.createdAt).toISOString()}
                        title={time.absolute}
                        className="block truncate text-xs font-medium"
                      >
                        {time.relative}
                      </time>
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {t("common.tabsCount", {
                          count: session.tabs.length,
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreSession(session.id)}
                      aria-label={t("popup.restoreSession", {
                        time: time.relative,
                      })}
                      className="shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {t("common.restore")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
          <label
            className="inline-flex min-w-0 items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
            title={t("settings.open.toolbarAction.description")}
          >
            <MousePointerClick aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">
              {t("settings.open.toolbarAction.label")}
            </span>
            <select
              aria-label={t("settings.open.toolbarAction.label")}
              value={toolbarAction}
              onChange={(event) =>
                changeToolbarAction(event.target.value as ToolbarAction)
              }
              className="max-w-[9rem] rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-[11px] text-neutral-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
            >
              {TOOLBAR_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`settings.option.open.toolbarAction.${action}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void openSettingsPage()}
            className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
          >
            {t("common.settings")}
          </button>
        </footer>
      </main>

      {saveConfirmCount !== null && (
        <ConfirmDialog
          title={t("sessions.saveConfirmTitle")}
          message={t("sessions.saveConfirmMessage", {
            count: saveConfirmCount,
          })}
          confirmLabel={t("sessions.saveConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={confirmSaveWindow}
          onCancel={cancelSaveWindow}
        />
      )}
    </div>
  );
}

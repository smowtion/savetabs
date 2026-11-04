/**
 * Sessions page shell.
 *
 * The page is a full-tab surface opened by the save flow, toolbar action,
 * context menus and keyboard commands (`/sessions.html`). It lists saved
 * sessions newest first (the repository already sorts them), keeps the newest
 * card expanded, and offers instant search over session names, tab titles and
 * tab URLs.
 *
 * Save, restore and delete are performed by the background service worker.
 * This page only validates and sends the typed runtime message, renders the
 * failure as a visible alert, and refreshes the list both after every action
 * and whenever another context announces a sessions change. Copy, rename and
 * single-session export run locally through the shared clipboard formatter,
 * the local repository and the sessions-file envelope respectively.
 */

import {
  APP_NAME,
  type ClipboardFormat,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { Monitor, Moon, Plus, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SessionCard, type UrlDisplayMode } from "../../components/SessionCard";
import { SearchBar } from "../../components/SearchBar";
import { useI18n } from "../../hooks/useI18n";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import type { UiResponse } from "../../lib/messages";
import type { RestoreResult } from "../../lib/restore";
import type { SaveTabsResult } from "../../lib/save-flow";
import { listSessions, onSessionsChanged } from "../../lib/sessions-repo";
import { nextThemePreference, normalizeThemePreference } from "../../lib/theme";
import {
  sendUiMessage,
  UnexpectedResponseError,
} from "../../lib/ui-message-client";

type Status = { kind: "success" | "error"; message: string };
type ErrorResponse = Extract<UiResponse, { ok: false }>;

/** Normalize the stored `urlDisplay.mode` value. */
function normalizeDisplayMode(value: unknown): UrlDisplayMode {
  return value === "domain" || value === "full-url" ? value : "title";
}

/** Normalize the stored `clipboard.format` value. */
function normalizeClipboardFormat(value: unknown): ClipboardFormat {
  return value === "markdown" || value === "titled" ? value : "plain-urls";
}

/** Boolean settings default to on; only an explicit false disables them. */
function readBoolean(settings: Settings, key: string): boolean {
  return settings[key] !== false;
}

/**
 * True when the query appears in the session name, a tab title or a tab URL.
 * Input is already lower-case and trimmed by the caller.
 */
function matchesSessionQuery(session: Session, query: string): boolean {
  if (
    session.title !== undefined &&
    session.title.toLowerCase().includes(query)
  ) {
    return true;
  }
  return session.tabs.some(
    (tab) =>
      tab.title.toLowerCase().includes(query) ||
      tab.url.toLowerCase().includes(query),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const { settings, updateSetting } = useSettings();
  const { lang, t } = useI18n(settings?.["general.language"]);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveConfirmCount, setSaveConfirmCount] = useState<number | null>(null);
  const mounted = useRef(true);

  const themePreference = normalizeThemePreference(settings?.["general.theme"]);
  useTheme(themePreference);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${APP_NAME} — ${t("sessions.title")}`;
  }, [lang, t]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await listSessions();
      if (mounted.current) setSessions(next);
    } catch (error) {
      console.error("[savetabs] failed to load sessions", error);
      if (mounted.current) {
        setSessions([]);
        setStatus({ kind: "error", message: t("sessions.loadFailed") });
      }
    }
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = onSessionsChanged(() => {
      void refresh();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    if (sessions === null) return [];
    const term = query.trim().toLowerCase();
    if (term === "") return sessions;
    return sessions.filter((session) => matchesSessionQuery(session, term));
  }, [sessions, query]);

  const defaultExpandedId = filtered[0]?.id;

  function toggleExpanded(id: string, expandedByDefault: boolean): void {
    setExpanded((current) => ({
      ...current,
      [id]: !(current[id] ?? expandedByDefault),
    }));
  }

  function responseError(response: ErrorResponse): string {
    if (response.code === "not_found") return t("sessions.sessionMissing");
    if (response.message !== undefined && response.message !== "") {
      return t("sessions.actionFailed", { message: response.message });
    }
    return t("common.error");
  }

  function reportFailure(response: ErrorResponse): void {
    setStatus({ kind: "error", message: responseError(response) });
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
        if (response.code === "confirmation_required") {
          setSaveConfirmCount(response.data?.count ?? 0);
          return;
        }
        reportFailure(response);
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
      await refresh();
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
        reportFailure(response);
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
    } finally {
      await refresh();
    }
  }

  async function deleteSessionById(sessionId: string): Promise<void> {
    setStatus(null);
    try {
      const response = await sendUiMessage({
        type: "DELETE_SESSION",
        sessionId,
      });
      if (!response.ok) {
        reportFailure(response);
        return;
      }
      setStatus({ kind: "success", message: t("sessions.deleteSuccess") });
    } catch (error) {
      reportException(error);
    } finally {
      await refresh();
    }
  }

  function cycleTheme(): void {
    void updateSetting(
      "general.theme",
      nextThemePreference(themePreference),
    ).catch((error) => {
      console.error("[savetabs] failed to save theme", error);
    });
  }

  const ThemeIcon =
    themePreference === "light"
      ? Sun
      : themePreference === "dark"
        ? Moon
        : Monitor;
  const themeLabel = t("options.theme.toggle", {
    theme: t(`options.theme.${themePreference}`),
  });

  const ready = settings !== null && sessions !== null;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">
            {APP_NAME}
            <span className="ml-2 align-middle text-sm font-normal text-neutral-500 dark:text-neutral-400">
              {t("sessions.title")}
            </span>
          </h1>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <SearchBar
              value={query}
              onChange={setQuery}
              label={t("sessions.searchLabel")}
              placeholder={t("sessions.searchPlaceholder")}
              inputId="sessions-search"
            />
            <button
              type="button"
              onClick={() => void saveWindow()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {t("sessions.saveWindow")}
            </button>
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={themeLabel}
              title={themeLabel}
              className="rounded-md border border-neutral-300 bg-white p-2 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <ThemeIcon aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {status !== null && (
          <div
            role={status.kind === "success" ? "status" : "alert"}
            className={`mb-4 rounded-md border px-3 py-2 text-sm ${
              status.kind === "success"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {status.message}
          </div>
        )}

        {!ready ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("common.loading")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
            {sessions.length === 0
              ? t("sessions.empty")
              : t("sessions.noResults")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((session) => {
              const expandedByDefault = session.id === defaultExpandedId;
              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  expanded={expanded[session.id] ?? expandedByDefault}
                  onToggleExpanded={() =>
                    toggleExpanded(session.id, expandedByDefault)
                  }
                  displayMode={normalizeDisplayMode(
                    settings["urlDisplay.mode"],
                  )}
                  showFavicons={readBoolean(
                    settings,
                    "urlDisplay.showFavicons",
                  )}
                  showTabCount={readBoolean(
                    settings,
                    "urlDisplay.showTabCount",
                  )}
                  clipboardFormat={normalizeClipboardFormat(
                    settings["clipboard.format"],
                  )}
                  lang={lang}
                  t={t}
                  onRestore={() => restoreSession(session.id)}
                  onDelete={() => deleteSessionById(session.id)}
                  onChanged={() => {
                    void refresh();
                  }}
                  onNotify={(kind, message) => setStatus({ kind, message })}
                />
              );
            })}
          </div>
        )}
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

/**
 * Web sessions page.
 *
 * The page derives the sync credentials from the stored key, downloads every
 * encrypted blob page (50 at a time), decrypts each session in the browser and
 * renders the result newest first. The server never sees plaintext and never
 * receives incognito sessions, so none can appear here.
 *
 * Failure rules:
 * - 401 means a registered key received the wrong bearer: show an auth banner
 *   with a "change key" action and never fall through to an empty-success state.
 * - 404 from the list endpoint means no key row exists for this authId. Because
 *   the authId is derived from the key, a mistyped key is a different (empty)
 *   vault; show a dedicated "no synced data for this key" state that asks the
 *   user to check the key. The generic empty state is reserved for a successful
 *   response with zero sessions.
 * - A blob that fails to decrypt, or that decrypts to a value without the
 *   required session fields, is counted and skipped; the other sessions still
 *   render. The header links to the landing page and privacy policy and offers
 *   a confirmed "Forget key" action that clears storage and returns home.
 */

import {
  SyncAuthError,
  SyncClient,
  SyncHttpError,
  decryptSession,
  type RemoteSessionBlob,
  type Session,
} from "@savetabs/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { SessionCard } from "../components/SessionCard";
import { useI18n } from "../hooks/useI18n";
import { API_BASE } from "../lib/config";
import { clearKey, deriveForWeb, loadKey } from "../lib/key-session";

const PAGE_SIZE = 50;
/** Hard stop for a server that keeps returning the same next page. */
const MAX_PAGES = 10_000;

type Status = { kind: "success" | "error"; message: string };

const SESSION_SOURCES: ReadonlySet<string> = new Set([
  "window",
  "all-windows",
  "tab",
  "selection",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * A decrypted blob is untrusted input: a corrupted or malicious entry may
 * decrypt but still lack the fields the card renders. Reject it here so one
 * bad session cannot break the whole page.
 */
function isValidSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    return false;
  }
  if (
    typeof value.source !== "string" ||
    !SESSION_SOURCES.has(value.source)
  ) {
    return false;
  }
  if (!Array.isArray(value.tabs)) return false;
  return value.tabs.every(
    (tab) =>
      isRecord(tab) &&
      typeof tab.url === "string" &&
      typeof tab.title === "string",
  );
}

/** Newest first, matching the extension's sessions list. */
function compareSessions(left: Session, right: Session): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** True when the query appears in the session name or a tab title. */
function matchesQuery(session: Session, query: string): boolean {
  if (session.title?.toLowerCase().includes(query) === true) return true;
  return session.tabs.some((tab) => tab.title.toLowerCase().includes(query));
}

export default function Sessions() {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [key] = useState(() => loadKey());
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [decryptFailures, setDecryptFailures] = useState(0);
  const [authError, setAuthError] = useState(false);
  const [keyUnknown, setKeyUnknown] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [forgetConfirmOpen, setForgetConfirmOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clientRef = useRef<SyncClient | null>(null);

  useEffect(() => {
    const storedKey = key;
    if (storedKey === null) return undefined;
    // Bind the narrowed value so the nested loader keeps the string type.
    const syncKey = storedKey;

    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const { authId, authKey, encKey } = await deriveForWeb(syncKey);
        const client = new SyncClient(API_BASE, authId, authKey);
        clientRef.current = client;

        const blobs: RemoteSessionBlob[] = [];
        let page = 0;

        for (let pages = 0; pages < MAX_PAGES; pages += 1) {
          const result = await client.listBlobs(page, PAGE_SIZE);
          blobs.push(...result.blobs);
          if (result.nextPage === undefined) break;
          page = result.nextPage;
        }

        const decrypted: Session[] = [];
        let failures = 0;

        for (const blob of blobs) {
          try {
            const session: unknown = await decryptSession(
              encKey,
              authId,
              blob.id,
              blob.ciphertext,
            );
            if (!isValidSession(session)) {
              failures += 1;
              continue;
            }
            // The server never stores incognito sessions; filter defensively
            // so a future server bug cannot leak private data into the UI.
            if (session.incognito === true) continue;
            decrypted.push(session);
          } catch {
            failures += 1;
          }
        }

        if (cancelled) return;
        decrypted.sort(compareSessions);
        setSessions(decrypted);
        setDecryptFailures(failures);
      } catch (error) {
        if (cancelled) return;

        if (error instanceof SyncAuthError) {
          setAuthError(true);
          return;
        }
        if (error instanceof SyncHttpError && error.status === 404) {
          // No key row for this authId: a mistyped key is a different vault.
          setKeyUnknown(true);
          return;
        }
        setLoadFailed(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const filtered = useMemo(() => {
    if (sessions === null) return [];
    const term = query.trim().toLowerCase();
    if (term === "") return sessions;
    return sessions.filter((session) => matchesQuery(session, term));
  }, [sessions, query]);

  function changeKey(): void {
    clearKey();
    navigate("/", { replace: true });
  }

  /** Explicit "Forget key": same effect as changeKey, behind a confirmation. */
  function forgetKey(): void {
    setForgetConfirmOpen(false);
    clearKey();
    navigate("/", { replace: true });
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const client = clientRef.current;
    if (client === null || authError) return;

    setStatus(null);
    try {
      await client.delete(sessionId);
    } catch (error) {
      if (error instanceof SyncAuthError) {
        setAuthError(true);
        return;
      }
      if (!(error instanceof SyncHttpError && error.status === 404)) {
        setStatus({
          kind: "error",
          message: t("web.sessions.deleteFailed", {
            message: errorMessage(error),
          }),
        });
        return;
      }
      // A 404 means the session is already gone, which is the desired state.
    }

    setSessions((current) =>
      current === null
        ? current
        : current.filter((session) => session.id !== sessionId),
    );
    setStatus({ kind: "success", message: t("web.sessions.deleteSuccess") });
  }

  // Every hook above runs on every render; only the tree below the guard is
  // skipped when the key disappeared (for example in another tab).
  if (key === null) return <Navigate to="/" replace />;

  const showEmptyState =
    sessions !== null && sessions.length === 0 && decryptFailures === 0;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <h1 className="text-lg font-semibold">{t("web.sessions.title")}</h1>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <nav className="flex items-center gap-3 text-xs font-medium">
              <Link
                to="/"
                className="text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-400"
              >
                {t("web.sessions.home")}
              </Link>
              <Link
                to="/privacy"
                className="text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-400"
              >
                {t("web.sessions.privacy")}
              </Link>
              <button
                type="button"
                onClick={() => setForgetConfirmOpen(true)}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("web.sessions.forgetKey")}
              </button>
            </nav>
            <label htmlFor="sessions-search" className="sr-only">
              {t("web.sessions.searchLabel")}
            </label>
            <input
              id="sessions-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("web.sessions.searchPlaceholder")}
              className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          {t("web.sessions.restoreHint")}
        </p>

        {authError ? (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            <p className="min-w-0 flex-1">{t("web.sessions.authError")}</p>
            <button
              type="button"
              onClick={changeKey}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
            >
              {t("web.sessions.changeKey")}
            </button>
          </div>
        ) : null}

        {keyUnknown ? (
          <section
            aria-labelledby="unknown-key-title"
            className="mb-4 rounded-lg border border-amber-300/70 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <h2 id="unknown-key-title" className="text-sm font-semibold">
              {t("web.sessions.unknownKeyTitle")}
            </h2>
            <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
              {t("web.sessions.unknownKey")}
            </p>
            <button
              type="button"
              onClick={changeKey}
              className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
              {t("web.sessions.changeKey")}
            </button>
          </section>
        ) : null}

        {decryptFailures > 0 ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {t("web.sessions.decryptError", { count: decryptFailures })}
          </div>
        ) : null}

        {loadFailed ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {t("web.sessions.loadFailed")}
          </div>
        ) : null}

        {status !== null ? (
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
        ) : null}

        {sessions === null ? (
          authError || loadFailed || keyUnknown ? null : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("common.loading")}
            </p>
          )
        ) : filtered.length === 0 ? (
          sessions.length === 0 ? (
            showEmptyState ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                {t("web.sessions.empty")}
              </p>
            ) : null
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              {t("web.sessions.noResults")}
            </p>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                lang={lang}
                t={t}
                onDelete={deleteSession}
                onNotify={(kind, message) => setStatus({ kind, message })}
              />
            ))}
          </div>
        )}
      </main>

      {forgetConfirmOpen && (
        <ConfirmDialog
          title={t("web.sessions.forgetKeyTitle")}
          message={t("web.sessions.forgetKeyMessage")}
          confirmLabel={t("web.sessions.forgetKeyConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={forgetKey}
          onCancel={() => setForgetConfirmOpen(false)}
        />
      )}
    </div>
  );
}

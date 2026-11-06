/**
 * Inline password unlock for an account session without a stored sync key.
 *
 * When the account token is still in `localStorage` but the sync key is gone
 * (a new tab, or a restart without "Remember on this device"), the sessions
 * page renders this form instead of redirecting to the landing page. The
 * profile lookup supplies the email; the password is stretched locally, sent
 * to the account API only as an HMAC proof, and the returned vault is
 * unwrapped in the browser. The key is handed to the parent, which stores it
 * with the caller's remember choice; it is never placed in the URL.
 */

import {
  deriveAuthHash,
  deriveKdfSalt,
  deriveMasterKey,
  deriveWrapKey,
  formatKey,
  unwrapSyncKey,
} from "@savetabs/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import { createAccountClient, loadAccountToken } from "../lib/account-session";

export type UnlockGateProps = {
  /** Hand the unwrapped key to the parent, which stores it. */
  onUnlocked: (key: string, remember: boolean) => void;
};

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";

export function UnlockGate({ onUnlocked }: UnlockGateProps) {
  const { t } = useI18n();
  const [token] = useState<string | null>(() => loadAccountToken());
  const [email, setEmail] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token === null) return undefined;

    let cancelled = false;
    createAccountClient().me(token).then(
      (profile) => {
        if (!cancelled) setEmail(profile.email);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting || email === null) return;

    setError(null);
    setSubmitting(true);

    try {
      // The salt is derived from the email, so it matches signup and login.
      const salt = await deriveKdfSalt(email);
      const masterKey = await deriveMasterKey(password, salt);
      const authHash = await deriveAuthHash(masterKey);
      const session = await createAccountClient().login({ email, authHash });
      if (session.vault === null) throw new Error("account has no vault");

      const rawKey = await unwrapSyncKey(
        await deriveWrapKey(masterKey),
        session.vault.wrappedKey,
        session.vault.authId,
      );
      onUnlocked(formatKey(rawKey), remember);
    } catch {
      setError(t("web.account.unlockError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (token === null) return null;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          SaveTabs
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-16 pt-4 sm:px-6">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t("web.account.unlockTitle")}
        </h1>
        <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
          {t("web.account.unlockDescription")}
        </p>
        {email !== null ? (
          <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {t("web.account.unlockAccount", { email })}
          </p>
        ) : null}

        {loadFailed ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {t("web.account.loadFailed")}
          </p>
        ) : null}

        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="mt-8 space-y-5"
        >
          <div>
            <label htmlFor="unlock-password" className={LABEL_CLASS}>
              {t("web.account.passwordLabel")}
            </label>
            <input
              id="unlock-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error !== null) setError(null);
              }}
              autoComplete="current-password"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className="flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 accent-indigo-600"
              />
              <span>{t("web.login.rememberLabel")}</span>
            </label>
            <p className="mt-1 ps-6 text-xs text-neutral-500 dark:text-neutral-400">
              {t("web.login.rememberWarning")}
            </p>
          </div>

          {error !== null ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting || email === null}
            aria-busy={submitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? t("web.account.unlockSubmitting")
              : t("web.account.unlockSubmit")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/login"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.login.title")}
          </Link>
        </p>
      </main>
    </div>
  );
}

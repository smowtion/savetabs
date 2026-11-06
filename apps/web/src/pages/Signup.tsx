/**
 * Web signup page.
 *
 * The password never leaves the browser. The page stretches it with PBKDF2
 * into a master key, sends only the HMAC authentication proof and the KDF
 * parameters to the account API, and keeps the AES-GCM wrapping key in memory
 * so it can encrypt the sync key into the account vault.
 *
 * After signup the page logs in and links the device's sync key:
 * - when the device already holds a key, that key is wrapped and linked;
 * - otherwise a fresh key is generated, so the user starts with an empty
 *   vault rather than adopting someone else's data;
 * - if login already returns a vault (a concurrent signup won the race), that
 *   key is unwrapped and adopted instead of linking a second one.
 *
 * The recovery key is shown once, after it is stored, and a required "I saved
 * it" checkbox gates the redirect to the sessions page. Account API failures
 * always render one generic message so the page never reveals whether an
 * address has an account.
 */

import {
  AccountApiError,
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKdfSalt,
  deriveKeys,
  deriveMasterKey,
  deriveWrapKey,
  encodeSalt,
  formatKey,
  generateKey,
  parseKey,
  unwrapSyncKey,
  wrapSyncKey,
} from "@savetabs/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { RecoveryKeyDialog } from "../components/RecoveryKeyDialog";
import { useI18n } from "../hooks/useI18n";
import { createAccountClient, saveAccountToken } from "../lib/account-session";
import {
  isKeyRemembered,
  loadKey,
  saveKeyForSession,
} from "../lib/key-session";

/** Minimum password length required before any derivation starts. */
const MIN_PASSWORD_LENGTH = 12;

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";

export default function Signup() {
  const { lang, t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting || recoveryKey !== null) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("web.signup.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("web.signup.passwordMismatch"));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // The salt is derived from the normalized email, so a later login on
      // another device derives the same salt without a server round trip.
      const accountEmail = email.trim().toLowerCase();
      const salt = await deriveKdfSalt(accountEmail);
      const masterKey = await deriveMasterKey(password, salt);
      const authHash = await deriveAuthHash(masterKey);
      const wrapKey = await deriveWrapKey(masterKey);
      const client = createAccountClient();

      await client.signup({
        email: accountEmail,
        authHash,
        kdfSalt: encodeSalt(salt),
        kdfIterations: KDF_ITERATIONS,
        locale: lang,
      });

      const session = await client.login({ email: accountEmail, authHash });
      let syncKey: string;

      if (session.vault !== null) {
        // A concurrent signup linked a vault between our signup and login;
        // adopt that key instead of silently creating a second one. The vault
        // is bound to the sync key's authId, which the server returns.
        const rawKey = await unwrapSyncKey(
          wrapKey,
          session.vault.wrappedKey,
          session.vault.authId,
        );
        syncKey = formatKey(rawKey);
      } else {
        syncKey = loadKey() ?? generateKey();
        const rawKey = parseKey(syncKey);
        const { authId, authKey } = await deriveKeys(rawKey);
        const wrappedKey = await wrapSyncKey(wrapKey, rawKey, authId);
        await client.linkKey(session.token, {
          authId,
          authKey,
          wrappedKey,
          authHash,
        });
      }

      saveAccountToken(session.token);
      // Keep the existing "remember on this device" choice instead of
      // clearing the persistent copy that was just loaded.
      setRecoveryKey(saveKeyForSession(syncKey, isKeyRemembered()));
    } catch (cause) {
      setError(
        cause instanceof AccountApiError
          ? t("web.signup.error")
          : t("common.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

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
          {t("web.signup.title")}
        </h1>
        <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
          {t("web.signup.description")}
        </p>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="mt-8 space-y-5"
        >
          <div>
            <label htmlFor="signup-email" className={LABEL_CLASS}>
              {t("web.signup.emailLabel")}
            </label>
            <input
              id="signup-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error !== null) setError(null);
              }}
              placeholder={t("web.signup.emailPlaceholder")}
              autoComplete="email"
              spellCheck={false}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="signup-password" className={LABEL_CLASS}>
              {t("web.signup.passwordLabel")}
            </label>
            <input
              id="signup-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error !== null) setError(null);
              }}
              autoComplete="new-password"
              aria-describedby="signup-password-hint"
              className={FIELD_CLASS}
            />
            <p
              id="signup-password-hint"
              className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
            >
              {t("web.signup.passwordHint")}
            </p>
          </div>

          <div>
            <label htmlFor="signup-confirm" className={LABEL_CLASS}>
              {t("web.signup.confirmLabel")}
            </label>
            <input
              id="signup-confirm"
              name="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                if (error !== null) setError(null);
              }}
              autoComplete="new-password"
              className={FIELD_CLASS}
            />
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
            disabled={submitting}
            aria-busy={submitting}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? t("web.signup.submitting")
              : t("web.signup.submit")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.signup.back")}
          </Link>
        </p>
      </main>

      {recoveryKey !== null ? (
        <RecoveryKeyDialog
          recoveryKey={recoveryKey}
          t={t}
          onContinue={() => navigate("/sessions")}
        />
      ) : null}
    </div>
  );
}

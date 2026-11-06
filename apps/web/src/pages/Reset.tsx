/**
 * Web page for the emailed reset link of an account without a vault.
 *
 * The token comes from `?token=`; the email is only used to derive the KDF
 * salt, exactly as login does, so nothing about the account is sent except the
 * new proof and salt. The server refuses a token whose account has a linked
 * vault, which keeps this path away from encrypted data.
 */

import {
  AccountApiError,
  KDF_ITERATIONS,
  deriveAuthHash,
  deriveKdfSalt,
  deriveMasterKey,
  encodeSalt,
} from "@savetabs/shared";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import { createAccountClient } from "../lib/account-session";

/** Minimum password length required before any derivation starts. */
const MIN_PASSWORD_LENGTH = 12;

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";

export default function Reset() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const tokenParam = params.get("token");
  const token =
    tokenParam !== null && tokenParam.length > 0 ? tokenParam : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting || token === null) return;
    // The salt is derived from this address; an empty value would rotate the
    // proof to a salt login can never reproduce.
    if (email.trim() === "") return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("web.recover.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("web.recover.passwordMismatch"));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // The salt is derived from the normalized email, so the next login on
      // any device derives the same salt without a server round trip.
      const accountEmail = email.trim().toLowerCase();
      const salt = await deriveKdfSalt(accountEmail);
      const masterKey = await deriveMasterKey(password, salt);
      const authHash = await deriveAuthHash(masterKey);

      await createAccountClient().confirmUnlinkedReset({
        token,
        // The server binds the token to its account, so this must match the
        // address the reset email was sent to.
        email: accountEmail,
        authHash,
        kdfSalt: encodeSalt(salt),
        kdfIterations: KDF_ITERATIONS,
      });
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof AccountApiError
          ? t("web.reset.error")
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
        {token === null ? (
          <>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {t("web.reset.invalidTokenTitle")}
            </h1>
            <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
              {t("web.reset.invalidToken")}
            </p>
            <p className="mt-6 text-center text-sm">
              <Link
                to="/login"
                className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
              >
                {t("web.reset.login")}
              </Link>
            </p>
          </>
        ) : done ? (
          <>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {t("web.reset.successTitle")}
            </h1>
            <p
              role="status"
              className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400"
            >
              {t("web.reset.success")}
            </p>
            <p className="mt-6 text-center text-sm">
              <Link
                to="/login"
                className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
              >
                {t("web.reset.login")}
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {t("web.recover.title")}
            </h1>
            <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
              {t("web.reset.description")}
            </p>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              noValidate
              className="mt-8 space-y-5"
            >
              <div>
                <label htmlFor="reset-email" className={LABEL_CLASS}>
                  {t("web.recover.emailLabel")}
                </label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error !== null) setError(null);
                  }}
                  placeholder={t("web.recover.emailPlaceholder")}
                  autoComplete="email"
                  spellCheck={false}
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label htmlFor="reset-password" className={LABEL_CLASS}>
                  {t("web.recover.passwordLabel")}
                </label>
                <input
                  id="reset-password"
                  name="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error !== null) setError(null);
                  }}
                  autoComplete="new-password"
                  aria-describedby="reset-password-hint"
                  className={FIELD_CLASS}
                />
                <p
                  id="reset-password-hint"
                  className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {t("web.recover.passwordHint")}
                </p>
              </div>

              <div>
                <label htmlFor="reset-confirm" className={LABEL_CLASS}>
                  {t("web.recover.confirmLabel")}
                </label>
                <input
                  id="reset-confirm"
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
                disabled={submitting || email.trim() === ""}
                aria-busy={submitting}
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? t("web.recover.submitting")
                  : t("web.recover.submit")}
              </button>

              <Link
                to="/login"
                className="block w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                {t("web.recover.cancel")}
              </Link>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

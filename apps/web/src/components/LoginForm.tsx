/**
 * Presentational email/password sign-in form.
 *
 * All derivation happens after submit in the page; this component only owns
 * markup and accessibility labels. The remember control follows the same
 * session/localStorage rules as key entry on the landing page.
 */

import type { FormEvent } from "react";

import { useI18n } from "../hooks/useI18n";

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";
const SECONDARY_BUTTON_CLASS =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export type LoginFormValues = {
  email: string;
  password: string;
  remember: boolean;
};

export type LoginFormProps = {
  values: LoginFormValues;
  error: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRecover: () => void;
};

export function LoginForm({
  values,
  error,
  submitting,
  onEmailChange,
  onPasswordChange,
  onRememberChange,
  onSubmit,
  onRecover,
}: LoginFormProps) {
  const { t } = useI18n();

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
      <div>
        <label htmlFor="login-email" className={LABEL_CLASS}>
          {t("web.login.emailLabel")}
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          value={values.email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder={t("web.login.emailPlaceholder")}
          autoComplete="email"
          spellCheck={false}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="login-password" className={LABEL_CLASS}>
          {t("web.login.passwordLabel")}
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          value={values.password}
          onChange={(event) => onPasswordChange(event.target.value)}
          autoComplete="current-password"
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label
          htmlFor="login-remember"
          className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200"
        >
          <input
            id="login-remember"
            type="checkbox"
            checked={values.remember}
            onChange={(event) => onRememberChange(event.target.checked)}
            className="size-4 rounded border-neutral-300 accent-indigo-600"
          />
          <span>{t("web.login.rememberLabel")}</span>
        </label>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
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
        disabled={submitting}
        aria-busy={submitting}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? t("web.login.submitting") : t("web.login.submit")}
      </button>

      <button
        type="button"
        onClick={onRecover}
        disabled={submitting}
        className={SECONDARY_BUTTON_CLASS}
      >
        {t("web.login.recoveryLink")}
      </button>
    </form>
  );
}

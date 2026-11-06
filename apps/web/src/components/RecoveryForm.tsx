/**
 * Presentational recovery-key password reset form.
 *
 * The recovery key is the sync key (`ST-…`). The page parses it, derives the
 * new proof and wraps the same raw key; this component only owns markup and
 * the client-side length/match checks' error display.
 */

import type { FormEvent } from "react";

import { useI18n } from "../hooks/useI18n";

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";
const SECONDARY_BUTTON_CLASS =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export type RecoveryFormValues = {
  email: string;
  recoveryKey: string;
  newPassword: string;
  confirm: string;
};

export type RecoveryFormProps = {
  values: RecoveryFormValues;
  error: string | null;
  submitting: boolean;
  onEmailChange: (value: string) => void;
  onRecoveryKeyChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export function RecoveryForm({
  values,
  error,
  submitting,
  onEmailChange,
  onRecoveryKeyChange,
  onNewPasswordChange,
  onConfirmChange,
  onSubmit,
  onCancel,
}: RecoveryFormProps) {
  const { t } = useI18n();

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
      <div>
        <label htmlFor="recover-email" className={LABEL_CLASS}>
          {t("web.recover.emailLabel")}
        </label>
        <input
          id="recover-email"
          name="email"
          type="email"
          value={values.email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder={t("web.recover.emailPlaceholder")}
          autoComplete="email"
          spellCheck={false}
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="recover-key" className={LABEL_CLASS}>
          {t("web.recover.keyLabel")}
        </label>
        <input
          id="recover-key"
          name="recovery-key"
          type="password"
          value={values.recoveryKey}
          onChange={(event) => onRecoveryKeyChange(event.target.value)}
          placeholder={t("web.recover.keyPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className={`${FIELD_CLASS} font-mono`}
        />
      </div>

      <div>
        <label htmlFor="recover-password" className={LABEL_CLASS}>
          {t("web.recover.passwordLabel")}
        </label>
        <input
          id="recover-password"
          name="new-password"
          type="password"
          value={values.newPassword}
          onChange={(event) => onNewPasswordChange(event.target.value)}
          autoComplete="new-password"
          aria-describedby="recover-password-hint"
          className={FIELD_CLASS}
        />
        <p
          id="recover-password-hint"
          className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
        >
          {t("web.recover.passwordHint")}
        </p>
      </div>

      <div>
        <label htmlFor="recover-confirm" className={LABEL_CLASS}>
          {t("web.recover.confirmLabel")}
        </label>
        <input
          id="recover-confirm"
          name="confirm-password"
          type="password"
          value={values.confirm}
          onChange={(event) => onConfirmChange(event.target.value)}
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
        {submitting ? t("web.recover.submitting") : t("web.recover.submit")}
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className={SECONDARY_BUTTON_CLASS}
      >
        {t("web.recover.cancel")}
      </button>
    </form>
  );
}

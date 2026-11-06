/**
 * Recovery-key section for the account page.
 *
 * The key is only revealed after the page's reveal action proves the password
 * with a fresh login and unwraps the vault. This component keeps the revealed
 * key in memory only: it is rendered into a `<code>` element, never stored and
 * never added to the URL, and can be hidden again.
 */

import { AccountApiError } from "@savetabs/shared";
import { useState, type FormEvent } from "react";

import { useI18n } from "../hooks/useI18n";
import { MissingVaultError } from "../lib/account-settings";
import {
  ACCOUNT_ALERT_CLASS,
  ACCOUNT_FIELD_CLASS,
  ACCOUNT_LABEL_CLASS,
  ACCOUNT_PRIMARY_BUTTON_CLASS,
  ACCOUNT_SECTION_CLASS,
} from "./account-styles";

export type RecoveryKeySectionProps = {
  /** Verify the password and return the formatted sync key. */
  onReveal: (password: string) => Promise<string>;
};

export function RecoveryKeySection({ onReveal }: RecoveryKeySectionProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    if (password.length === 0) {
      setError(t("web.account.passwordRequired"));
      return;
    }

    setSubmitting(true);
    try {
      setRecoveryKey(await onReveal(password));
      setPassword("");
    } catch (cause) {
      setError(
        cause instanceof MissingVaultError
          ? t("web.account.noVault")
          : cause instanceof AccountApiError
            ? t("web.account.viewKeyFailed")
            : t("common.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="account-recovery-title" className={ACCOUNT_SECTION_CLASS}>
      <h2 id="account-recovery-title" className="text-sm font-semibold">
        {t("web.account.recoveryKeyTitle")}
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {t("web.account.recoveryKeyDescription")}
      </p>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="mt-4 space-y-4"
      >
        <div>
          <label htmlFor="account-view-password" className={ACCOUNT_LABEL_CLASS}>
            {t("web.account.passwordLabel")}
          </label>
          <input
            id="account-view-password"
            name="recovery-password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error !== null) setError(null);
            }}
            autoComplete="current-password"
            className={ACCOUNT_FIELD_CLASS}
          />
        </div>

        {error !== null ? (
          <p role="alert" className={ACCOUNT_ALERT_CLASS}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className={ACCOUNT_PRIMARY_BUTTON_CLASS}
        >
          {submitting
            ? t("web.account.viewKeySubmitting")
            : t("web.account.viewKeySubmit")}
        </button>
      </form>

      {recoveryKey !== null ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t("web.account.viewKeyLabel")}
          </p>
          <code className="mt-1 block break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            {recoveryKey}
          </code>
          <button
            type="button"
            onClick={() => setRecoveryKey(null)}
            className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("web.account.hideKey")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

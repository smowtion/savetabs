/**
 * Change-password form for the account page.
 *
 * Owns the field state and the client-side checks (required current password,
 * 12-character minimum, confirmation match). The page performs the derivation
 * and API call; failures come back as typed errors so this form can show the
 * matching message without exposing a server reason.
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

/** Minimum password length required before any derivation starts. */
const MIN_PASSWORD_LENGTH = 12;

export type ChangePasswordSectionProps = {
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
};

type Status = { kind: "success" | "error"; message: string };

export function ChangePasswordSection({
  onChangePassword,
}: ChangePasswordSectionProps) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setStatus(null);
    if (currentPassword.length === 0) {
      setError(t("web.account.passwordRequired"));
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("web.account.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("web.account.passwordMismatch"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus({
        kind: "success",
        message: t("web.account.passwordChanged"),
      });
    } catch (cause) {
      setError(
        cause instanceof MissingVaultError
          ? t("web.account.noVault")
          : cause instanceof AccountApiError
            ? t("web.account.passwordChangeFailed")
            : t("common.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="account-password-title" className={ACCOUNT_SECTION_CLASS}>
      <h2 id="account-password-title" className="text-sm font-semibold">
        {t("web.account.changePasswordTitle")}
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {t("web.account.changePasswordDescription")}
      </p>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
        className="mt-4 space-y-4"
      >
        <div>
          <label htmlFor="account-current-password" className={ACCOUNT_LABEL_CLASS}>
            {t("web.account.currentPasswordLabel")}
          </label>
          <input
            id="account-current-password"
            name="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
              if (error !== null) setError(null);
            }}
            autoComplete="current-password"
            className={ACCOUNT_FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="account-new-password" className={ACCOUNT_LABEL_CLASS}>
            {t("web.account.newPasswordLabel")}
          </label>
          <input
            id="account-new-password"
            name="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              if (error !== null) setError(null);
            }}
            autoComplete="new-password"
            aria-describedby="account-password-hint"
            className={ACCOUNT_FIELD_CLASS}
          />
          <p
            id="account-password-hint"
            className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
          >
            {t("web.account.passwordHint")}
          </p>
        </div>

        <div>
          <label htmlFor="account-confirm-password" className={ACCOUNT_LABEL_CLASS}>
            {t("web.account.confirmPasswordLabel")}
          </label>
          <input
            id="account-confirm-password"
            name="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              if (error !== null) setError(null);
            }}
            autoComplete="new-password"
            className={ACCOUNT_FIELD_CLASS}
          />
        </div>

        {error !== null ? (
          <p role="alert" className={ACCOUNT_ALERT_CLASS}>
            {error}
          </p>
        ) : null}
        {status !== null ? (
          <p
            role={status.kind === "success" ? "status" : "alert"}
            className={
              status.kind === "success"
                ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                : ACCOUNT_ALERT_CLASS
            }
          >
            {status.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className={ACCOUNT_PRIMARY_BUTTON_CLASS}
        >
          {submitting
            ? t("web.account.changePasswordSubmitting")
            : t("web.account.changePasswordSubmit")}
        </button>
      </form>
    </section>
  );
}

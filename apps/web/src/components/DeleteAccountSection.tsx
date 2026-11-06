/**
 * Delete-account section for the account page.
 *
 * Deletion always requires the password, which the page turns into the proof
 * the account API verifies. A separate checkbox opts into deleting the cloud
 * data for the account's sync key; when it is unchecked the page never touches
 * sync storage. A confirmation dialog gates the irreversible action.
 */

import { AccountApiError } from "@savetabs/shared";
import { useState, type FormEvent } from "react";

import { useI18n } from "../hooks/useI18n";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ACCOUNT_ALERT_CLASS,
  ACCOUNT_DANGER_BUTTON_CLASS,
  ACCOUNT_FIELD_CLASS,
  ACCOUNT_LABEL_CLASS,
  ACCOUNT_SECTION_CLASS,
} from "./account-styles";

export type DeleteAccountSectionProps = {
  /** Delete the account; rejects with the API error on failure. */
  onDelete: (password: string, deleteCloudData: boolean) => Promise<void>;
};

export function DeleteAccountSection({ onDelete }: DeleteAccountSectionProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [deleteCloudData, setDeleteCloudData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (deleting) return;

    setError(null);
    if (password.length === 0) {
      setError(t("web.account.passwordRequired"));
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmDelete(): Promise<void> {
    if (deleting) return;

    setConfirmOpen(false);
    setDeleting(true);
    try {
      await onDelete(password, deleteCloudData);
    } catch (cause) {
      setError(
        cause instanceof AccountApiError
          ? t("web.account.deleteFailed")
          : t("common.error"),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section aria-labelledby="account-delete-title" className={ACCOUNT_SECTION_CLASS}>
      <h2 id="account-delete-title" className="text-sm font-semibold">
        {t("web.account.deleteTitle")}
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        {t("web.account.deleteDescription")}
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
        <div>
          <label htmlFor="account-delete-password" className={ACCOUNT_LABEL_CLASS}>
            {t("web.account.deletePasswordLabel")}
          </label>
          <input
            id="account-delete-password"
            name="delete-password"
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

        <div>
          <label className="flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={deleteCloudData}
              onChange={(event) => setDeleteCloudData(event.target.checked)}
              className="mt-0.5 size-4 rounded border-neutral-300 accent-red-600"
            />
            <span>{t("web.account.deleteCloudLabel")}</span>
          </label>
          <p className="mt-1 ps-6 text-xs text-neutral-500 dark:text-neutral-400">
            {t("web.account.deleteCloudHint")}
          </p>
        </div>

        {error !== null ? (
          <p role="alert" className={ACCOUNT_ALERT_CLASS}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={deleting}
          aria-busy={deleting}
          className={ACCOUNT_DANGER_BUTTON_CLASS}
        >
          {deleting
            ? t("web.account.deleteDeleting")
            : t("web.account.deleteSubmit")}
        </button>
      </form>

      {confirmOpen ? (
        <ConfirmDialog
          title={t("web.account.deleteConfirmTitle")}
          message={
            deleteCloudData
              ? t("web.account.deleteCloudConfirmMessage")
              : t("web.account.deleteConfirmMessage")
          }
          confirmLabel={t("web.account.deleteConfirm")}
          cancelLabel={t("common.cancel")}
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}

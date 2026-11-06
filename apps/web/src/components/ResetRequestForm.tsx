/**
 * Inline "email me a reset link" form on the login page.
 *
 * Only accounts without a linked vault can reset by email, and the server
 * answers identically for unknown addresses, so the UI shows one generic
 * acknowledgement whatever the input. The current locale travels with the
 * request; the server still renders the message in the account's stored
 * language.
 */

import { useState, type FormEvent } from "react";

import { useI18n } from "../hooks/useI18n";
import { createAccountClient } from "../lib/account-session";

const FIELD_CLASS =
  "mt-2 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const LABEL_CLASS =
  "block text-sm font-medium text-neutral-800 dark:text-neutral-200";
const SECONDARY_BUTTON_CLASS =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";

export type ResetRequestFormProps = {
  defaultEmail: string;
  onCancel: () => void;
};

type Status = "idle" | "sending" | "success" | "error";

export function ResetRequestForm({
  defaultEmail,
  onCancel,
}: ResetRequestFormProps) {
  const { lang, t } = useI18n();
  const [email, setEmail] = useState(defaultEmail);
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (status === "sending") return;

    setStatus("sending");
    try {
      await createAccountClient().requestUnlinkedReset({
        email: email.trim().toLowerCase(),
        locale: lang,
      });
      setStatus("success");
    } catch {
      // Unknown addresses and delivery failures share one generic message.
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="mt-6 space-y-3">
        <p
          role="status"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
        >
          {t("web.login.resetSuccess")}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className={SECONDARY_BUTTON_CLASS}
        >
          {t("web.recover.cancel")}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="mt-6 space-y-4"
    >
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {t("web.login.resetHint")}
      </p>

      <div>
        <label htmlFor="reset-request-email" className={LABEL_CLASS}>
          {t("web.login.emailLabel")}
        </label>
        <input
          id="reset-request-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status === "error") setStatus("idle");
          }}
          placeholder={t("web.login.emailPlaceholder")}
          autoComplete="email"
          spellCheck={false}
          className={FIELD_CLASS}
        />
      </div>

      {status === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {t("web.login.resetFailed")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "sending" || email.trim() === ""}
        aria-busy={status === "sending"}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "sending"
          ? t("web.login.resetSubmitting")
          : t("web.login.resetSubmit")}
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={status === "sending"}
        className={SECONDARY_BUTTON_CLASS}
      >
        {t("web.recover.cancel")}
      </button>
    </form>
  );
}

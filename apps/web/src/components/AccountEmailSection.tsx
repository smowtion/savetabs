/**
 * Email card for the account page.
 *
 * Shows the signed-in address and its verification state. An unverified
 * address offers a resend action; the server rate-limits the send, so the
 * component only needs to report success or a generic failure.
 */

import { AccountApiError } from "@savetabs/shared";
import { useState } from "react";

import { useI18n } from "../hooks/useI18n";
import {
  ACCOUNT_ALERT_CLASS,
  ACCOUNT_SECTION_CLASS,
} from "./account-styles";

export type AccountEmailSectionProps = {
  email: string;
  verified: boolean;
  /** Send a new verification email; rejects with the API error on failure. */
  onResend: () => Promise<void>;
};

type Status = { kind: "success" | "error"; message: string };

export function AccountEmailSection({
  email,
  verified,
  onResend,
}: AccountEmailSectionProps) {
  const { t } = useI18n();
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function handleResend(): Promise<void> {
    if (resending) return;

    setStatus(null);
    setResending(true);
    try {
      await onResend();
      setStatus({
        kind: "success",
        message: t("web.account.resendSuccess"),
      });
    } catch (cause) {
      setStatus({
        kind: "error",
        message:
          cause instanceof AccountApiError
            ? t("web.account.resendFailed")
            : t("common.error"),
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <section aria-labelledby="account-email-title" className={ACCOUNT_SECTION_CLASS}>
      <h2
        id="account-email-title"
        className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        {t("web.account.emailLabel")}
      </h2>
      <p className="mt-1 break-all text-sm font-medium">{email}</p>

      {verified ? (
        <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-400">
          {t("web.account.verified")}
        </p>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="text-sm">{t("web.account.unverified")}</p>
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resending}
            aria-busy={resending}
            className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resending ? t("web.account.resending") : t("web.account.resend")}
          </button>
          {status !== null ? (
            <p
              role={status.kind === "success" ? "status" : "alert"}
              className={
                status.kind === "success"
                  ? "mt-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                  : `mt-2 ${ACCOUNT_ALERT_CLASS}`
              }
            >
              {status.message}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

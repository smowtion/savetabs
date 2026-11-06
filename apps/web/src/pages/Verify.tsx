/**
 * Email verification page.
 *
 * The link in the verification email carries a single-use token. This page
 * consumes it on mount and renders one of three outcomes: verified, expired
 * (the API answers 410), or a generic failure. Verification never needs the
 * sync key, so the page is public and does not touch key storage.
 */

import { AccountApiError } from "@savetabs/shared";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import { createAccountClient } from "../lib/account-session";

type Status = "checking" | "verified" | "expired" | "error";

/** Translation keys for each state; every state has a heading and a message. */
const STATE_TEXT: Record<
  Status,
  { titleKey: string; messageKey: string }
> = {
  checking: { titleKey: "web.verify.title", messageKey: "web.verify.checking" },
  verified: {
    titleKey: "web.verify.successTitle",
    messageKey: "web.verify.success",
  },
  expired: {
    titleKey: "web.verify.expiredTitle",
    messageKey: "web.verify.expired",
  },
  error: {
    titleKey: "web.verify.errorTitle",
    messageKey: "web.verify.error",
  },
};

export default function Verify() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>(
    token === null || token === "" ? "error" : "checking",
  );

  useEffect(() => {
    if (token === null || token === "") return;

    let cancelled = false;
    createAccountClient()
      .verifyEmail(token)
      .then(
        () => {
          if (!cancelled) setStatus("verified");
        },
        (cause: unknown) => {
          if (cancelled) return;
          // 410 is the API's invalid-or-expired link answer.
          setStatus(
            cause instanceof AccountApiError && cause.status === 410
              ? "expired"
              : "error",
          );
        },
      );

    return () => {
      cancelled = true;
    };
  }, [token]);

  const { titleKey, messageKey } = STATE_TEXT[status];

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
          {t(titleKey)}
        </h1>
        <p
          role={status === "error" ? "alert" : "status"}
          className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400"
        >
          {t(messageKey)}
        </p>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.verify.back")}
          </Link>
        </p>
      </main>
    </div>
  );
}

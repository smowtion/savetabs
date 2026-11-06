/**
 * Account card rendered at the top of the Sync section.
 *
 * Signed out, it offers email/password sign-in, inline account creation and a
 * "use a key instead" exit that leaves the existing key management visible.
 * Signed in, it shows the account email, its verification state, sign-out and
 * password change. Changing the password re-wraps the account's sync key, so
 * the form asks for the current password before calling the session module.
 *
 * The card never owns key material. All derivations, vault operations and
 * token storage live in `lib/account-session`; this component only holds form
 * state and renders the one-time recovery key dialog after a key is linked.
 */

import type { AccountProfile, Translator } from "@savetabs/shared";
import { useEffect, useId, useState, type FormEvent } from "react";

import {
  changePassword,
  getAccount,
  signIn,
  signOut,
  signUp,
  type AccountSessionResult,
} from "../lib/account-session";
import { ConfirmDialog } from "./ConfirmDialog";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";

/** Minimum password length required before creating an account. */
const MIN_PASSWORD_LENGTH = 12;

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";
const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50";
const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export type AccountCardProps = {
  t: Translator;
};

type PendingAction = "sign-in" | "sign-up" | "sign-out" | "change-password";

type Status = {
  kind: "success" | "error";
  message: string;
};

function StatusBanner({ status }: { status: Status }) {
  return (
    <div
      role={status.kind === "success" ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 text-sm ${
        status.kind === "success"
          ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
          : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      {status.message}
    </div>
  );
}

function VerificationBadge({
  verified,
  t,
}: {
  verified: boolean;
  t: Translator;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        verified
          ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      }`}
    >
      {verified
        ? t("settings.account.verified")
        : t("settings.account.unverified")}
    </span>
  );
}

export function AccountCard({ t }: AccountCardProps) {
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [keyOnly, setKeyOnly] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Resolver for the "upload local sessions?" question. The session module
  // awaits this promise, so the dialog replaces the native `window.confirm`
  // with localized copy while the sign-in stays pending.
  const [uploadPrompt, setUploadPrompt] = useState<{
    resolve: (upload: boolean) => void;
  } | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const currentPasswordId = useId();
  const newPasswordId = useId();

  // A token from an earlier session opens the card signed in. A revoked token
  // is cleared by `getAccount`, which leaves the sign-in form in place.
  useEffect(() => {
    let active = true;

    getAccount()
      .then((profile) => {
        if (active && profile !== null) setAccount(profile);
      })
      .catch((error) => {
        if (!active) return;
        console.error("[savetabs] failed to load the account", error);
        setStatus({
          kind: "error",
          message: t("settings.account.loadFailed"),
        });
      });

    return () => {
      active = false;
    };
  }, [t]);

  async function completeSignIn(
    action: "sign-in" | "sign-up",
    run: () => Promise<AccountSessionResult>,
    failureMessage: string,
  ): Promise<void> {
    setPending(action);
    setStatus(null);

    try {
      const result = await run();
      setAccount(result.account);
      setPassword("");
      if (result.recoveryKey !== null) setRecoveryKey(result.recoveryKey);
    } catch {
      setStatus({ kind: "error", message: failureMessage });
    } finally {
      setPending(null);
    }
  }

  /** Ask, through the localized dialog, before uploading local sessions. */
  function confirmUpload(): Promise<boolean> {
    return new Promise((resolve) => setUploadPrompt({ resolve }));
  }

  function answerUploadPrompt(upload: boolean): void {
    const pendingPrompt = uploadPrompt;
    setUploadPrompt(null);
    pendingPrompt?.resolve(upload);
  }

  function handleSignIn(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending !== null) return;
    void completeSignIn(
      "sign-in",
      () => signIn(email, password, { confirmUpload }),
      t("settings.account.signInFailed"),
    );
  }

  function handleSignUp(): void {
    if (pending !== null) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        kind: "error",
        message: t("settings.account.passwordTooShort"),
      });
      return;
    }
    void completeSignIn(
      "sign-up",
      () => signUp(email, password, { confirmUpload }),
      t("settings.account.signUpFailed"),
    );
  }

  async function handleSignOut(): Promise<void> {
    if (pending !== null) return;
    setPending("sign-out");
    setStatus(null);

    try {
      // Only the account token is removed; the sync key and sync settings are
      // left untouched so sync keeps working under the key.
      await signOut();
      setAccount(null);
      setEmail("");
      setPassword("");
      setStatus({
        kind: "success",
        message: t("settings.account.signedOut"),
      });
    } catch {
      setStatus({
        kind: "error",
        message: t("settings.account.signOutFailed"),
      });
    } finally {
      setPending(null);
    }
  }

  function beginPasswordChange(): void {
    setChangingPassword(true);
    setCurrentPassword("");
    setNewPassword("");
    setStatus(null);
  }

  function cancelPasswordChange(): void {
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
  }

  async function submitPasswordChange(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (pending !== null) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        kind: "error",
        message: t("settings.account.passwordTooShort"),
      });
      return;
    }

    setPending("change-password");
    setStatus(null);

    try {
      // The session module proves the current password, re-wraps the account's
      // key under the new one and stores the replacement token.
      await changePassword(currentPassword, newPassword);
      setChangingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setStatus({
        kind: "success",
        message: t("settings.account.changePasswordSuccess"),
      });
    } catch {
      setStatus({
        kind: "error",
        message: t("settings.account.changePasswordFailed"),
      });
    } finally {
      setPending(null);
    }
  }

  const statusBanner =
    status !== null ? <StatusBanner status={status} /> : null;

  // The first linked key becomes the account's recovery key; the dialog must
  // stay visible across the switch to the signed-in branch.
  const recoveryDialog =
    recoveryKey !== null ? (
      <RecoveryKeyDialog
        recoveryKey={recoveryKey}
        t={t}
        onContinue={() => setRecoveryKey(null)}
      />
    ) : null;

  // Offered only when the account vault replaces a different device key and
  // local sessions exist; resolving the promise lets the sign-in finish.
  const uploadDialog =
    uploadPrompt !== null ? (
      <ConfirmDialog
        title={t("settings.account.uploadPromptTitle")}
        message={t("settings.account.uploadPrompt")}
        confirmLabel={t("settings.account.uploadPromptUpload")}
        cancelLabel={t("settings.account.uploadPromptSkip")}
        onConfirm={() => answerUploadPrompt(true)}
        onCancel={() => answerUploadPrompt(false)}
      />
    ) : null;

  if (account !== null) {
    return (
      <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <div>
          <h3 className="text-sm font-semibold">
            {t("settings.account.title")}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">{account.email}</span>
            <VerificationBadge verified={account.emailVerified} t={t} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void handleSignOut()}
            className={BUTTON_CLASS}
          >
            {t("settings.account.signOut")}
          </button>
          {!changingPassword && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={beginPasswordChange}
              className={BUTTON_CLASS}
            >
              {t("settings.account.changePassword")}
            </button>
          )}
        </div>
        {changingPassword && (
          <form
            onSubmit={(event) => void submitPasswordChange(event)}
            noValidate
            className="flex flex-col gap-2"
          >
            <div>
              <label
                htmlFor={currentPasswordId}
                className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
              >
                {t("settings.account.currentPasswordLabel")}
              </label>
              <input
                id={currentPasswordId}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor={newPasswordId}
                className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
              >
                {t("settings.account.newPasswordLabel")}
              </label>
              <input
                id={newPasswordId}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={
                  pending !== null ||
                  currentPassword === "" ||
                  newPassword === ""
                }
                className={PRIMARY_BUTTON_CLASS}
              >
                {pending === "change-password"
                  ? t("settings.account.changePasswordSubmitting")
                  : t("settings.account.changePasswordSubmit")}
              </button>
              <button
                type="button"
                disabled={pending === "change-password"}
                onClick={cancelPasswordChange}
                className={BUTTON_CLASS}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
        {statusBanner}
        {recoveryDialog}
        {uploadDialog}
      </div>
    );
  }

  const formDisabled =
    pending !== null || email.trim() === "" || password === "";

  return (
    <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <div>
        <h3 className="text-sm font-semibold">
          {t("settings.account.title")}
        </h3>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("settings.account.description")}
        </p>
      </div>

      {keyOnly ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("settings.account.keyOnlyHint")}
          </p>
          <div>
            <button
              type="button"
              onClick={() => setKeyOnly(false)}
              className={BUTTON_CLASS}
            >
              {t("settings.account.useAccount")}
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSignIn}
          noValidate
          className="flex flex-col gap-2"
        >
          <div>
            <label
              htmlFor={emailId}
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
            >
              {t("settings.account.emailLabel")}
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              placeholder={t("settings.account.emailPlaceholder")}
              onChange={(event) => setEmail(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor={passwordId}
              className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
            >
              {t("settings.account.passwordLabel")}
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={formDisabled}
              className={PRIMARY_BUTTON_CLASS}
            >
              {pending === "sign-in"
                ? t("settings.account.signingIn")
                : t("settings.account.signIn")}
            </button>
            <button
              type="button"
              disabled={formDisabled}
              onClick={handleSignUp}
              className={BUTTON_CLASS}
            >
              {pending === "sign-up"
                ? t("settings.account.creatingAccount")
                : t("settings.account.createAccount")}
            </button>
            <button
              type="button"
              onClick={() => setKeyOnly(true)}
              className={BUTTON_CLASS}
            >
              {t("settings.account.useKeyInstead")}
            </button>
          </div>
        </form>
      )}

      {statusBanner}
      {recoveryDialog}
      {uploadDialog}
    </div>
  );
}

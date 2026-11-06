/**
 * Web account page.
 *
 * Loads the signed-in profile and renders the account sections: email and
 * verification state, password change, recovery-key reveal, and account
 * deletion. The sections own their form state; every derivation and vault
 * operation lives in `lib/account-settings`. The recovery key is shown only
 * after a fresh password proof and is never placed in the URL.
 *
 * The password change revokes the previous account token server-side, so the
 * page replaces its in-memory token with the returned one and keeps working.
 * Account deletion always proves the password; deleting the sync data is a
 * separate opt-in that uses the key-derived sync credentials.
 */

import { AccountApiError, type AccountProfile } from "@savetabs/shared";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AccountEmailSection } from "../components/AccountEmailSection";
import { ChangePasswordSection } from "../components/ChangePasswordSection";
import { DeleteAccountSection } from "../components/DeleteAccountSection";
import { RecoveryKeySection } from "../components/RecoveryKeySection";
import {
  ACCOUNT_ALERT_CLASS,
  ACCOUNT_LINK_CLASS,
} from "../components/account-styles";
import { useI18n } from "../hooks/useI18n";
import {
  changeAccountPassword,
  deleteAccountWithPassword,
  revealRecoveryKey,
  signOutAccount,
} from "../lib/account-settings";
import {
  clearAccountToken,
  createAccountClient,
  loadAccountToken,
} from "../lib/account-session";

export default function Account() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => loadAccountToken());
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (token === null) return undefined;

    let cancelled = false;
    createAccountClient().me(token).then(
      (next) => {
        if (!cancelled) setProfile(next);
      },
      (cause: unknown) => {
        if (cancelled) return;
        // 401 means the token expired or was revoked; send the user to sign in.
        if (cause instanceof AccountApiError && cause.status === 401) {
          clearAccountToken();
          setToken(null);
          return;
        }
        setLoadFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSignOut(): Promise<void> {
    if (token === null) return;
    await signOutAccount(token);
    navigate("/", { replace: true });
  }

  // Every hook above runs on every render; the redirects below only choose
  // the tree to render.
  if (token === null) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-4">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            SaveTabs
          </Link>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3 text-xs font-medium">
            <Link to="/sessions" className={ACCOUNT_LINK_CLASS}>
              {t("web.account.sessionsLink")}
            </Link>
            <Link to="/" className={ACCOUNT_LINK_CLASS}>
              {t("web.account.home")}
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t("web.account.logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("web.account.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {t("web.account.description")}
        </p>

        {loadFailed ? (
          <p role="alert" className={`mt-4 ${ACCOUNT_ALERT_CLASS}`}>
            {t("web.account.loadFailed")}
          </p>
        ) : null}

        {profile === null ? (
          loadFailed ? null : (
            <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
              {t("common.loading")}
            </p>
          )
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <AccountEmailSection
              email={profile.email}
              verified={profile.emailVerified}
              onResend={async () => {
                await createAccountClient().resendVerification(token);
              }}
            />

            <ChangePasswordSection
              onChangePassword={async (currentPassword, newPassword) => {
                const nextToken = await changeAccountPassword(
                  token,
                  profile.email,
                  currentPassword,
                  newPassword,
                );
                // The old token was revoked by the password change.
                setToken(nextToken);
              }}
            />

            <RecoveryKeySection
              onReveal={(password) => revealRecoveryKey(profile.email, password)}
            />

            <DeleteAccountSection
              onDelete={async (password, deleteCloudData) => {
                await deleteAccountWithPassword({
                  token,
                  email: profile.email,
                  password,
                  deleteCloudData,
                });
                navigate("/", { replace: true });
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

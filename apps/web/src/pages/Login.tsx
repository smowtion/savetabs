/**
 * Web login and recovery page.
 *
 * The page owns form state, validation copy and the required recovery-key
 * acknowledgement; `account-login` owns the derivation, vault unwrap/link and
 * key storage. Account API and malformed-key failures render one generic
 * message so the page never reveals whether an email or recovery key was the
 * wrong part.
 */

import { AccountApiError, InvalidKeyError } from "@savetabs/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { LoginForm, type LoginFormValues } from "../components/LoginForm";
import { RecoveryForm, type RecoveryFormValues } from "../components/RecoveryForm";
import { RecoveryKeyDialog } from "../components/RecoveryKeyDialog";
import { useI18n } from "../hooks/useI18n";
import { recoverAccount, signInWithPassword } from "../lib/account-login";

/** Minimum password length required before any derivation starts. */
const MIN_PASSWORD_LENGTH = 12;

const EMPTY_LOGIN: LoginFormValues = {
  email: "",
  password: "",
  remember: false,
};

const EMPTY_RECOVERY: RecoveryFormValues = {
  email: "",
  recoveryKey: "",
  newPassword: "",
  confirm: "",
};

type Mode = "login" | "recover";

export default function Login() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [login, setLogin] = useState<LoginFormValues>(EMPTY_LOGIN);
  const [recovery, setRecovery] =
    useState<RecoveryFormValues>(EMPTY_RECOVERY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const isRecover = mode === "recover";

  function clearError(): void {
    if (error !== null) setError(null);
  }

  function updateLogin(patch: Partial<LoginFormValues>): void {
    setLogin((current) => ({ ...current, ...patch }));
    clearError();
  }

  function updateRecovery(patch: Partial<RecoveryFormValues>): void {
    setRecovery((current) => ({ ...current, ...patch }));
    clearError();
  }

  function openRecovery(): void {
    // Carry the email over so the user does not type it twice.
    setRecovery({ ...EMPTY_RECOVERY, email: login.email });
    setMode("recover");
    clearError();
  }

  function openLogin(): void {
    setRecovery(EMPTY_RECOVERY);
    setMode("login");
    clearError();
  }

  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting || recoveryKey !== null) return;

    setError(null);
    setSubmitting(true);

    try {
      const outcome = await signInWithPassword(
        login.email,
        login.password,
        login.remember,
      );

      if (outcome.kind === "linked") {
        // The account had no vault; acknowledge the generated recovery key
        // before the sessions page opens.
        setRecoveryKey(outcome.recoveryKey);
      } else {
        navigate("/sessions");
      }
    } catch (cause) {
      setError(
        cause instanceof AccountApiError
          ? t("web.login.error")
          : t("common.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecover(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting || recoveryKey !== null) return;

    if (recovery.newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t("web.recover.passwordTooShort"));
      return;
    }
    if (recovery.newPassword !== recovery.confirm) {
      setError(t("web.recover.passwordMismatch"));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await recoverAccount(
        recovery.email,
        recovery.recoveryKey,
        recovery.newPassword,
      );
      navigate("/sessions");
    } catch (cause) {
      setError(
        cause instanceof AccountApiError || cause instanceof InvalidKeyError
          ? t("web.recover.error")
          : t("common.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

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
          {isRecover ? t("web.recover.title") : t("web.login.title")}
        </h1>
        <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
          {isRecover
            ? t("web.recover.description")
            : t("web.login.description")}
        </p>

        {isRecover ? (
          <RecoveryForm
            values={recovery}
            error={error}
            submitting={submitting}
            onEmailChange={(value) => updateRecovery({ email: value })}
            onRecoveryKeyChange={(value) =>
              updateRecovery({ recoveryKey: value })
            }
            onNewPasswordChange={(value) =>
              updateRecovery({ newPassword: value })
            }
            onConfirmChange={(value) => updateRecovery({ confirm: value })}
            onSubmit={(event) => void handleRecover(event)}
            onCancel={openLogin}
          />
        ) : (
          <LoginForm
            values={login}
            error={error}
            submitting={submitting}
            onEmailChange={(value) => updateLogin({ email: value })}
            onPasswordChange={(value) => updateLogin({ password: value })}
            onRememberChange={(value) => updateLogin({ remember: value })}
            onSubmit={(event) => void handleLogin(event)}
            onRecover={openRecovery}
          />
        )}

        <p className="mt-6 text-center text-sm">
          <Link
            to="/signup"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.login.createAccount")}
          </Link>
        </p>
        <p className="mt-3 text-center text-sm">
          <Link
            to="/"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.login.back")}
          </Link>
        </p>
      </main>

      {recoveryKey !== null ? (
        <RecoveryKeyDialog
          recoveryKey={recoveryKey}
          t={t}
          onContinue={() => navigate("/sessions")}
        />
      ) : null}
    </div>
  );
}

import { InvalidKeyError } from "@savetabs/shared";
import {
  KeyRound,
  Languages,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import { useTheme, type WebThemePreference } from "../hooks/useTheme";
import {
  isKeyRemembered,
  loadKey,
  saveKeyForSession,
} from "../lib/key-session";

/**
 * Landing page: enter a sync key to reach the session list.
 *
 * The key is validated locally and stored in sessionStorage by default (or
 * localStorage when the device is trusted). It is never added to the URL.
 */

const THEME_ICONS: Record<
  WebThemePreference,
  typeof Monitor | typeof Sun | typeof Moon
> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const CONTROLS_BUTTON_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

export default function Landing() {
  const { lang, t, toggleLang } = useI18n();
  const { preference, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [key, setKey] = useState(() => loadKey() ?? "");
  const [remember, setRemember] = useState(() => isKeyRemembered());
  const [error, setError] = useState<string | null>(null);

  const ThemeIcon = THEME_ICONS[preference];
  const themeLabel = `${t("web.theme.toggle")}: ${t(
    `web.theme.${preference}`,
  )}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    try {
      saveKeyForSession(key, remember);
      setError(null);
      navigate("/sessions");
    } catch (cause) {
      setError(
        cause instanceof InvalidKeyError
          ? t("web.landing.invalidKey")
          : t("common.error"),
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white">
            <KeyRound aria-hidden="true" size={18} />
          </span>
          SaveTabs
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t("web.language.toggle")}
            className={CONTROLS_BUTTON_CLASS}
          >
            <Languages aria-hidden="true" size={16} />
            <span aria-hidden="true">{lang === "en" ? "VI" : "EN"}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={themeLabel}
            className={CONTROLS_BUTTON_CLASS}
          >
            <ThemeIcon aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-16 pt-4 sm:px-6">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t("web.landing.title")}
        </h1>
        <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
          {t("web.landing.description")}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="sync-key"
              className="block text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {t("web.landing.keyLabel")}
            </label>
            <input
              id="sync-key"
              name="sync-key"
              type="password"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                if (error !== null) setError(null);
              }}
              placeholder={t("web.landing.keyPlaceholder")}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "sync-key-error" : undefined}
              className={`mt-2 block w-full rounded-xl border bg-white px-3 py-3 font-mono text-sm tracking-wide text-neutral-900 outline-none transition focus:ring-2 focus:ring-indigo-500/40 dark:bg-neutral-900 dark:text-neutral-100 ${
                error !== null
                  ? "border-red-500 focus:border-red-500 dark:border-red-500"
                  : "border-neutral-300 focus:border-indigo-500 dark:border-neutral-700"
              }`}
            />
            {error !== null ? (
              <p
                id="sync-key-error"
                role="alert"
                className="mt-2 text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            ) : null}
          </div>

          <p className="flex gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={18}
            />
            <span>{t("web.landing.loseKeyWarning")}</span>
          </p>

          <div>
            <label className="flex items-start gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 accent-indigo-600"
              />
              <span>{t("web.landing.rememberLabel")}</span>
            </label>
            <p className="mt-1 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
              {t("web.landing.rememberWarning")}
            </p>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            {t("web.landing.continue")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link
            to="/privacy"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            {t("web.landing.privacyLink")}
          </Link>
        </p>
      </main>
    </div>
  );
}

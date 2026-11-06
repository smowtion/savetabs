import { InvalidKeyError } from "@savetabs/shared";
import type { Translator } from "@savetabs/shared";
import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  isKeyRemembered,
  loadKey,
  saveKeyForSession,
} from "../../lib/key-session";
import {
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  TEXT_LINK_CLASS,
} from "./landing-styles";

/**
 * Secondary, key-only path: enter a sync key to reach the sessions page.
 *
 * The key is validated locally and stored in sessionStorage by default (or
 * localStorage when the device is trusted). It is never added to the URL.
 * The section carries `id="use-sync-key"` so the account call to action can
 * anchor here without JavaScript.
 */

type Props = { t: Translator };

export function SyncKeyPanel({ t }: Props) {
  const navigate = useNavigate();
  const [key, setKey] = useState(() => loadKey() ?? "");
  const [remember, setRemember] = useState(() => isKeyRemembered());
  const [error, setError] = useState<string | null>(null);

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
    <section
      id="use-sync-key"
      aria-labelledby="sync-key-heading"
      className={`${SECTION_CLASS} scroll-mt-20`}
    >
      <div className={SECTION_INNER_CLASS}>
        <div className="mx-auto max-w-xl rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900 sm:p-8">
          <h2
            id="sync-key-heading"
            className="text-balance text-2xl font-bold tracking-tight"
          >
            {t("web.landing.title")}
          </h2>
          <p className="mt-3 text-pretty text-sm leading-6 text-neutral-600 dark:text-neutral-400">
            {t("web.landing.description")}
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-5">
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
                className={`mt-2 block w-full rounded-xl border bg-white px-3 py-3 font-mono text-sm tracking-wide text-neutral-900 outline-none transition focus:ring-2 focus:ring-indigo-500/40 dark:bg-neutral-950 dark:text-neutral-100 ${
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
            <Link to="/privacy" className={TEXT_LINK_CLASS}>
              {t("web.landing.privacyLink")}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

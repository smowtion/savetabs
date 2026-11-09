import type { Translator } from "@savetabs/shared";

import {
  DISABLED_BUTTON_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  TEXT_LINK_CLASS,
} from "./landing-styles";
import { CHROME_STORE_URL, FIREFOX_STORE_URL } from "./store-links";

/**
 * Hero: the one `h1`, the product pitch, install actions and a CSS mockup of
 * the extension popup.
 *
 * The mockup is a visual aid only: it is hidden from assistive technology and
 * contains no links or controls, so it never competes with the real actions.
 * Chrome and Firefox are live; Safari stays disabled until its store listing
 * exists. A text link under the install actions jumps straight to the sync-key
 * form, which is the next section on the page.
 */

type Props = { t: Translator };

const MOCKUP_SESSIONS = ["sessionOne", "sessionTwo"] as const;

export function Hero({ t }: Props) {
  return (
    <section aria-labelledby="landing-hero" className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <span className="motion-fade-up inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            {t("web.landing.hero.eyebrow")}
          </span>
          <h1
            id="landing-hero"
            className="motion-fade-up mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
          >
            {t("web.landing.hero.title")}
          </h1>
          <p
            className="motion-fade-up mt-5 max-w-xl text-pretty text-lg leading-8 text-neutral-600 dark:text-neutral-400"
            style={{ animationDelay: "90ms" }}
          >
            {t("web.landing.hero.description")}
          </p>

          <div
            className="motion-fade-up mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={PRIMARY_LINK_CLASS}
            >
              <img
                src="/icons/chrome.svg"
                alt=""
                width={18}
                height={18}
                className="size-4"
              />
              {t("web.landing.hero.chrome")}
            </a>
            <a
              href={FIREFOX_STORE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={SECONDARY_LINK_CLASS}
            >
              <img
                src="/icons/firefox.svg"
                alt=""
                width={18}
                height={18}
                className="size-4"
              />
              {t("web.landing.hero.firefox")}
            </a>
            <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
              <img
                src="/icons/safari.svg"
                alt=""
                width={18}
                height={18}
                className="size-4"
              />
              <span>{t("web.landing.hero.safari")}</span>
              <span className="rounded-md bg-neutral-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {t("web.landing.hero.comingSoon")}
              </span>
            </button>
          </div>

          <p
            className="motion-fade-up mt-5 text-sm text-neutral-500 dark:text-neutral-400"
            style={{ animationDelay: "270ms" }}
          >
            {t("web.landing.hero.noAccount")}
          </p>

          <p
            className="motion-fade-up mt-4 text-sm"
            style={{ animationDelay: "320ms" }}
          >
            <a href="#use-sync-key" className={TEXT_LINK_CLASS}>
              {t("web.landing.title")}
            </a>
          </p>
        </div>

        <PopupMockup t={t} />
      </div>
    </section>
  );
}

function PopupMockup({ t }: Props) {
  return (
    <div
      aria-hidden="true"
      className="motion-float-y relative mx-auto w-full max-w-sm"
    >
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-indigo-500/10 blur-2xl dark:bg-indigo-500/20" />
      <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/30">
        <div className="flex items-center justify-between border-b border-neutral-200 pb-2 dark:border-neutral-800">
          <span className="text-xs font-semibold tracking-tight">SaveTabs</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
            <span className="size-1.5 rounded-full bg-green-500" />
            {t("web.landing.hero.mockup.sync")}
          </span>
        </div>

        <div className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-center text-xs font-semibold text-white">
          {t("web.landing.hero.mockup.save")}
        </div>

        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t("web.landing.hero.mockup.sessions")}
          </p>
          <div className="mt-1.5 space-y-1.5">
            {MOCKUP_SESSIONS.map((session) => (
              <div
                key={session}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-2.5 py-2 dark:border-neutral-800"
              >
                <span className="truncate text-[11px] font-medium">
                  {t(`web.landing.hero.mockup.${session}`)}
                </span>
                <span className="shrink-0 rounded-md border border-neutral-300 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                  {t("web.landing.hero.mockup.restore")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import type { Translator } from "@savetabs/shared";

import {
  CARD_CLASS,
  DISABLED_BUTTON_CLASS,
  MUTED_TEXT_CLASS,
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";
import { CHROME_STORE_URL, FIREFOX_STORE_URL } from "./store-links";

/**
 * Install actions, a visual guide, and factual uninstall/troubleshooting copy.
 *
 * Chrome and Firefox listings are live; Safari is built but not distributed
 * yet. No steps mention unverifiable numbers.
 */

type Props = { t: Translator };

const ITEMS = ["install", "uninstall", "troubleshooting"] as const;

export function InstallHelp({ t }: Props) {
  return (
    <section aria-labelledby="landing-install" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id="landing-install" className={SECTION_TITLE_CLASS}>
          {t("web.landing.install.title")}
        </h2>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={PRIMARY_LINK_CLASS}
          >
            <img src="/icons/chrome.svg" alt="" width={18} height={18} className="size-4" />
            {t("web.landing.hero.chrome")}
          </a>
          <a
            href={FIREFOX_STORE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={SECONDARY_LINK_CLASS}
          >
            <img src="/icons/firefox.svg" alt="" width={18} height={18} className="size-4" />
            {t("web.landing.hero.firefox")}
          </a>
          <button type="button" disabled className={DISABLED_BUTTON_CLASS}>
            <img src="/icons/safari.svg" alt="" width={18} height={18} className="size-4" />
            {t("web.landing.hero.safari")}
            <span className="rounded-md bg-neutral-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {t("web.landing.hero.comingSoon")}
            </span>
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 dark:border-neutral-800">
          <img
            src="/images/guide-install.webp"
            alt=""
            width={640}
            height={640}
            loading="lazy"
            decoding="async"
            className="h-48 w-full object-cover sm:h-56"
          />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {ITEMS.map((item) => (
            <article key={item} className={CARD_CLASS}>
              <h3 className="text-base font-semibold tracking-tight">
                {t(`web.landing.install.items.${item}.title`)}
              </h3>
              <p className={`mt-2 ${MUTED_TEXT_CLASS}`}>
                {t(`web.landing.install.items.${item}.body`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

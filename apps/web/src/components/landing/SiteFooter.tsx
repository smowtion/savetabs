import type { Translator } from "@savetabs/shared";
import { Link } from "react-router-dom";

import { TEXT_LINK_CLASS } from "./landing-styles";
import { CHROME_STORE_URL, FIREFOX_STORE_URL, SUPPORT_EMAIL } from "./store-links";

/**
 * Footer: support address, privacy policy and the store listing.
 *
 * The support link opens the user's mail client, so the visible text is the
 * address itself and no extra label is required.
 */

type Props = { t: Translator };

export function SiteFooter({ t }: Props) {
  return (
    <footer className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <img
            src="/icon.svg"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          SaveTabs
        </span>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <a href={`mailto:${SUPPORT_EMAIL}`} className={TEXT_LINK_CLASS}>
            {SUPPORT_EMAIL}
          </a>
          <Link to="/privacy" className={TEXT_LINK_CLASS}>
            {t("web.landing.footer.privacy")}
          </Link>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={TEXT_LINK_CLASS}
          >
            {t("web.landing.footer.store")}
          </a>
          <a
            href={FIREFOX_STORE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className={TEXT_LINK_CLASS}
          >
            {t("web.landing.footer.firefoxStore")}
          </a>
        </div>
      </div>
    </footer>
  );
}

import type { Translator } from "@savetabs/shared";
import { Link } from "react-router-dom";

import {
  PRIMARY_LINK_CLASS,
  SECONDARY_LINK_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_LEAD_CLASS,
  SECTION_TITLE_CLASS,
  TEXT_LINK_CLASS,
} from "./landing-styles";

/**
 * Account call to action.
 *
 * Creating an account and signing in are the primary paths; key-only users
 * keep a direct anchor to the sync-key form at the top of the page.
 */

type Props = { t: Translator };

export function AccountCta({ t }: Props) {
  return (
    <section aria-labelledby="landing-account" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <div className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-7 dark:border-indigo-500/30 dark:from-indigo-950/40 dark:to-neutral-900 sm:p-10">
          <h2 id="landing-account" className={SECTION_TITLE_CLASS}>
            {t("web.landing.account.title")}
          </h2>
          <p className={SECTION_LEAD_CLASS}>
            {t("web.landing.account.description")}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link to="/signup" className={PRIMARY_LINK_CLASS}>
              {t("web.landing.account.create")}
            </Link>
            <Link to="/login" className={SECONDARY_LINK_CLASS}>
              {t("web.landing.account.signIn")}
            </Link>
          </div>

          <p className="mt-5 text-sm">
            <a href="#use-sync-key" className={TEXT_LINK_CLASS}>
              {t("web.landing.account.useKey")}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

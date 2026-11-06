import type { Translator } from "@savetabs/shared";
import { Link } from "react-router-dom";

import {
  CARD_CLASS,
  MUTED_TEXT_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_TITLE_CLASS,
  TEXT_LINK_CLASS,
} from "./landing-styles";

/**
 * Privacy summary: end-to-end encryption, the key-only path, local-first
 * storage and the local-only rule for private windows.
 *
 * The full policy lives on `/privacy`; this section links to it.
 */

type Props = { t: Translator };

const ITEMS = ["e2ee", "keyOnly", "localFirst", "privateWindows"] as const;

export function PrivacySection({ t }: Props) {
  return (
    <section aria-labelledby="landing-privacy" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id="landing-privacy" className={SECTION_TITLE_CLASS}>
          {t("web.landing.privacy.title")}
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ITEMS.map((item) => (
            <article key={item} className={CARD_CLASS}>
              <h3 className="text-base font-semibold tracking-tight">
                {t(`web.landing.privacy.items.${item}.title`)}
              </h3>
              <p className={`mt-2 ${MUTED_TEXT_CLASS}`}>
                {t(`web.landing.privacy.items.${item}.body`)}
              </p>
            </article>
          ))}
        </div>

        <p className="mt-6">
          <Link to="/privacy" className={TEXT_LINK_CLASS}>
            {t("web.landing.privacy.link")}
          </Link>
        </p>
      </div>
    </section>
  );
}

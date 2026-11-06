import type { Translator } from "@savetabs/shared";

import {
  CARD_CLASS,
  MUTED_TEXT_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Short, factual install, uninstall and troubleshooting copy.
 *
 * The Chrome listing is live; Firefox is intentionally described as
 * unpublished. No steps mention unverifiable numbers.
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

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
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

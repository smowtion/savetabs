import type { Translator } from "@savetabs/shared";

import {
  CARD_CLASS,
  MUTED_TEXT_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Feature grid: search, rename, export/import, auto-discard, multi-device
 * sync and local-only private windows.
 *
 * Copy stays factual; no memory or performance numbers are claimed.
 */

type Props = { t: Translator };

const ITEMS = [
  "search",
  "rename",
  "exportImport",
  "autoDiscard",
  "sync",
  "privateWindows",
] as const;

export function FeatureGrid({ t }: Props) {
  return (
    <section aria-labelledby="landing-features" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id="landing-features" className={SECTION_TITLE_CLASS}>
          {t("web.landing.features.title")}
        </h2>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ITEMS.map((item) => (
            <li key={item} className={CARD_CLASS}>
              <h3 className="text-base font-semibold tracking-tight">
                {t(`web.landing.features.items.${item}.title`)}
              </h3>
              <p className={`mt-2 ${MUTED_TEXT_CLASS}`}>
                {t(`web.landing.features.items.${item}.body`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

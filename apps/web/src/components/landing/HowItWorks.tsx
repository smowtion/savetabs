import type { Translator } from "@savetabs/shared";

import {
  CARD_CLASS,
  MUTED_TEXT_CLASS,
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Three-step explanation: save a window, tabs close, restore later.
 *
 * Rendered as an ordered list so the sequence is exposed to screen readers.
 */

type Props = { t: Translator };

const STEPS = ["save", "close", "restore"] as const;

export function HowItWorks({ t }: Props) {
  return (
    <section aria-labelledby="landing-how-it-works" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id="landing-how-it-works" className={SECTION_TITLE_CLASS}>
          {t("web.landing.howItWorks.title")}
        </h2>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step} className={CARD_CLASS}>
              <span className="grid size-9 place-items-center rounded-lg bg-indigo-600/10 text-sm font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                {index + 1}
              </span>
              <h3 className="mt-4 text-base font-semibold tracking-tight">
                {t(`web.landing.howItWorks.steps.${step}.title`)}
              </h3>
              <p className={`mt-2 ${MUTED_TEXT_CLASS}`}>
                {t(`web.landing.howItWorks.steps.${step}.body`)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

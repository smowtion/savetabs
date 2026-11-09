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
 * Each step pairs the copy with a generated illustration; images are
 * decorative because the adjacent text already describes the step.
 */

type Props = { t: Translator };

const STEPS = ["save", "close", "restore"] as const;

const STEP_IMAGES: Readonly<Record<(typeof STEPS)[number], string>> = {
  save: "/images/guide-save.webp",
  close: "/images/guide-close.webp",
  restore: "/images/guide-restore.webp",
};

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
              <StepVisual step={step} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepVisual({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <StepScreenshot
      src={STEP_IMAGES[step]}
      alt=""
      imgClassName="object-cover"
      width={640}
      height={640}
    />
  );
}

function StepScreenshot({
  src,
  alt,
  imgClassName,
  width = 1280,
  height = 800,
}: {
  src: string;
  alt: string;
  imgClassName: string;
  width?: number;
  height?: number;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={`h-40 w-full ${imgClassName}`}
      />
    </div>
  );
}

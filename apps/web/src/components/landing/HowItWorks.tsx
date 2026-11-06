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
 * Each step pairs the copy with a small visual: a cropped screenshot for the
 * save and restore steps, and a decorative CSS animation that collapses a
 * stack of tab bars into one session row for the close step.
 */

type Props = { t: Translator };

const STEPS = ["save", "close", "restore"] as const;

/** Tab bars in the close animation; delays stagger the collapse. */
const COLLAPSING_TABS = [
  { delay: 0, className: "bg-neutral-300/90 dark:bg-neutral-700" },
  { delay: 120, className: "bg-neutral-300/70 dark:bg-neutral-700/80" },
  { delay: 240, className: "bg-neutral-300/50 dark:bg-neutral-700/60" },
] as const;

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
              <StepVisual step={step} t={t} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepVisual({
  step,
  t,
}: {
  step: (typeof STEPS)[number];
  t: Translator;
}) {
  if (step === "save") {
    return (
      <StepScreenshot
        src="/screenshots/popup-card.png"
        alt={t("web.landing.guide.saveAlt")}
        imgClassName="object-contain"
        width={360}
        height={420}
      />
    );
  }

  if (step === "restore") {
    return (
      <StepScreenshot
        src="/screenshots/sessions.png"
        alt={t("web.landing.guide.restoreAlt")}
        imgClassName="object-cover object-top"
      />
    );
  }

  return <CloseAnimation />;
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

/**
 * Decorative close animation: three tab bars fade and collapse while one
 * session row fades in. `prefers-reduced-motion` shows only the session row.
 */
function CloseAnimation() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-4 flex h-40 items-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/60"
    >
      <div className="motion-tab-stack absolute inset-x-4 top-4">
        {COLLAPSING_TABS.map(({ delay, className }, index) => (
          <span
            key={delay}
            className={`motion-tab-bar absolute inset-x-0 h-3.5 rounded-md ${className}`}
            style={{
              top: `${index * 22}px`,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>

      <div className="motion-tab-session relative flex w-full items-center justify-between rounded-lg border border-indigo-200 bg-white px-2.5 py-2 dark:border-indigo-500/30 dark:bg-neutral-900">
        <span className="h-1.5 w-20 rounded-full bg-indigo-500/70" />
        <span className="h-1.5 w-8 rounded-full bg-indigo-500/40" />
      </div>
    </div>
  );
}

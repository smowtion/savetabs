import type { Lang, Translator } from "@savetabs/shared";
import { useState } from "react";

import {
  CARD_CLASS,
  SECTION_CLASS,
  SECTION_LEAD_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Interactive memory estimate.
 *
 * The chart is a calculator, not a usage claim: the user chooses the tab count
 * and an assumed memory per tab, and the bars compare that estimate with the
 * single session row SaveTabs keeps. The disclaimer makes the assumption
 * explicit.
 */

type Props = { t: Translator; lang: Lang };

const MIN_TABS = 10;
const MAX_TABS = 200;
const STEP_TABS = 5;
const MEMORY_OPTIONS = [25, 50, 100, 150] as const;

function formatMemory(megabytes: number): string {
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;
}

export function MemoryCalculator({ t, lang }: Props) {
  const [tabCount, setTabCount] = useState(50);
  const [mbPerTab, setMbPerTab] = useState(50);
  const estimatedMb = tabCount * mbPerTab;
  const formatted = formatMemory(estimatedMb);
  const tabsLabel = t("common.tabsCount", {
    count: new Intl.NumberFormat(lang).format(tabCount),
  });
  const afterWidth = `${Math.max(3, (1 / tabCount) * 100)}%`;

  return (
    <section aria-labelledby="landing-memory" className={SECTION_CLASS}>
      <div className="motion-fade-up mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_0.9fr] lg:items-center">
        <div>
          <h2 id="landing-memory" className={SECTION_TITLE_CLASS}>
            {t("web.landing.calculator.title")}
          </h2>
          <p className={SECTION_LEAD_CLASS}>
            {t("web.landing.calculator.subtitle")}
          </p>

          <div className="mt-7 flex flex-col gap-5">
            <label className="block">
              <span className="flex items-center justify-between gap-3 text-sm font-medium">
                {t("web.landing.calculator.tabsLabel")}
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {tabsLabel}
                </span>
              </span>
              <input
                type="range"
                min={MIN_TABS}
                max={MAX_TABS}
                step={STEP_TABS}
                value={tabCount}
                onChange={(event) => setTabCount(Number(event.target.value))}
                className="mt-3 w-full accent-indigo-600"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium">
                {t("web.landing.calculator.memoryLabel")}
              </span>
              <select
                value={mbPerTab}
                onChange={(event) => setMbPerTab(Number(event.target.value))}
                className="mt-2 w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {MEMORY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} MB
                  </option>
                ))}
              </select>
            </label>

            <p
              role="status"
              aria-live="polite"
              className="text-2xl font-bold tracking-tight text-indigo-700 dark:text-indigo-300"
            >
              {t("web.landing.calculator.result", { memory: formatted })}
            </p>
          </div>
        </div>

        <div className={CARD_CLASS}>
          <div className="flex flex-col gap-5">
            <div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">
                  {t("web.landing.calculator.before")}
                </span>
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  {tabsLabel} · {formatted}
                </span>
              </div>
              <div className="mt-2 h-9 w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500" />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">
                  {t("web.landing.calculator.after")}
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">
                  {t("web.landing.calculator.afterValue")}
                </span>
              </div>
              <div
                className="mt-2 h-9 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500"
                style={{ width: afterWidth }}
              />
            </div>
          </div>

          <p className="mt-5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            {t("web.landing.calculator.disclaimer")}
          </p>
        </div>
      </div>
    </section>
  );
}

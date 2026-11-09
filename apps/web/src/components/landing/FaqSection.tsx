import type { Translator } from "@savetabs/shared";
import { ChevronDown } from "lucide-react";

import {
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_LEAD_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Frequently asked questions.
 *
 * Each answer is a native disclosure so keyboard and screen-reader behaviour
 * comes from the platform. The illustrations are decorative: the question and
 * answer carry the information, so the images use an empty alt.
 */

type Props = { t: Translator };

const ITEMS = [
  { key: "account", image: "/images/faq-account.webp" },
  { key: "storage", image: "/images/faq-storage.webp" },
  { key: "devices", image: "/images/faq-devices.webp" },
  { key: "lostKey", image: "/images/faq-lost-key.webp" },
  { key: "tabs", image: "/images/guide-close.webp" },
  { key: "free", image: "/images/faq-free.webp" },
] as const;

export function FaqSection({ t }: Props) {
  return (
    <section aria-labelledby="landing-faq" className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id="landing-faq" className={SECTION_TITLE_CLASS}>
          {t("web.landing.faq.title")}
        </h2>
        <p className={SECTION_LEAD_CLASS}>
          {t("web.landing.faq.subtitle")}
        </p>

        <div className="mt-8 grid gap-3 lg:grid-cols-2">
          {ITEMS.map((item) => (
            <details
              key={item.key}
              className="group rounded-2xl border border-neutral-200 bg-white p-4 transition-colors open:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900 dark:open:border-indigo-500/40"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
                <img
                  src={item.image}
                  alt=""
                  width={72}
                  height={72}
                  loading="lazy"
                  decoding="async"
                  className="size-16 shrink-0 rounded-xl object-cover"
                />
                <span className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
                  {t(`web.landing.faq.items.${item.key}.q`)}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180 dark:text-neutral-400"
                />
              </summary>
              <p className="mt-3 ps-0 text-sm leading-6 text-neutral-600 sm:ps-[76px] dark:text-neutral-400">
                {t(`web.landing.faq.items.${item.key}.a`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

import type { Translator } from "@savetabs/shared";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import {
  SECTION_CLASS,
  SECTION_INNER_CLASS,
  SECTION_LEAD_CLASS,
  SECTION_TITLE_CLASS,
} from "./landing-styles";

/**
 * Screenshot gallery for the extension surfaces and the promotional art.
 *
 * The gallery is a standard ARIA tabset: the tabs move with the arrow, Home
 * and End keys, every tab points at its own panel, and only the selected
 * panel is rendered to assistive technology. The screenshots are local
 * assets, so the page still loads no third-party images.
 *
 * The sessions and settings screenshots fill the frame; the popup promo
 * image keeps its own dark backdrop and is contained so its full 16:10
 * composition stays visible.
 */

type Props = { t: Translator };

type GalleryKey = "promo" | "sessions" | "settings" | "popup" | "privacy";

const ITEMS: ReadonlyArray<{ key: GalleryKey; src: string }> = [
  { key: "promo", src: "/screenshots/overview-showcase.webp" },
  { key: "sessions", src: "/screenshots/sessions.png" },
  { key: "settings", src: "/screenshots/settings.png" },
  { key: "popup", src: "/screenshots/popup.png" },
  { key: "privacy", src: "/screenshots/privacy-showcase.webp" },
];

export function ScreenshotGallery({ t }: Props) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectTab(index: number) {
    setActive(index);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    // Arrow keys follow the visual direction, which flips for right-to-left.
    const rtl = document.documentElement.dir === "rtl";
    const forward = rtl ? -1 : 1;
    let next: number | null = null;

    if (event.key === "ArrowRight")
      next = (index + forward + ITEMS.length) % ITEMS.length;
    else if (event.key === "ArrowLeft")
      next = (index - forward + ITEMS.length) % ITEMS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ITEMS.length - 1;

    if (next !== null) {
      event.preventDefault();
      selectTab(next);
    }
  }

  return (
    <section aria-labelledby={titleId} className={SECTION_CLASS}>
      <div className={SECTION_INNER_CLASS}>
        <h2 id={titleId} className={SECTION_TITLE_CLASS}>
          {t("web.landing.gallery.title")}
        </h2>
        <p className={SECTION_LEAD_CLASS}>
          {t("web.landing.gallery.subtitle")}
        </p>

        <div
          role="tablist"
          aria-labelledby={titleId}
          className="mt-8 inline-flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900"
        >
          {ITEMS.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.key}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${item.key}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${item.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                  selected
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {t(`web.landing.gallery.tabs.${item.key}`)}
              </button>
            );
          })}
        </div>

        {ITEMS.map((item, index) => {
          const caption = t(`web.landing.gallery.captions.${item.key}`);
          const isPopup = item.key === "popup";

          return (
            <div
              key={item.key}
              role="tabpanel"
              id={`${baseId}-panel-${item.key}`}
              aria-labelledby={`${baseId}-tab-${item.key}`}
              hidden={index !== active}
              tabIndex={0}
              className="mt-6 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"
            >
              <figure className="group motion-hover-lift overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/40">
                <div
                  aria-hidden="true"
                  className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-100 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800"
                >
                  <span className="size-2.5 rounded-full bg-red-400/80" />
                  <span className="size-2.5 rounded-full bg-amber-400/80" />
                  <span className="size-2.5 rounded-full bg-green-400/80" />
                </div>

                <div
                  className={
                    isPopup
                      ? "relative bg-gradient-to-br from-neutral-950 via-indigo-950 to-neutral-900"
                      : "relative bg-neutral-100 dark:bg-neutral-800"
                  }
                >
                  <img
                    src={item.src}
                    alt={caption}
                    width={1280}
                    height={800}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    className={`motion-gallery-image h-auto w-full ${
                      isPopup ? "object-contain" : "object-cover"
                    }`}
                  />
                </div>

                <figcaption className="border-t border-neutral-200 px-5 py-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                  {caption}
                </figcaption>
              </figure>
            </div>
          );
        })}
      </div>
    </section>
  );
}

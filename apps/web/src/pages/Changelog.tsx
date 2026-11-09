import { ArrowLeft, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import {
  HEADER_CONTROL_CLASS,
  SECTION_INNER_CLASS,
} from "../components/landing/landing-styles";

/**
 * Public release history.
 *
 * Entries are maintained in this file because the same list is short enough to
 * review with each release. The latest entry is highlighted; dates are ISO
 * calendar dates, not build timestamps.
 */

type Release = {
  version: string;
  date: string;
  items: readonly string[];
};

const RELEASES: readonly Release[] = [
  {
    version: "0.2.3",
    date: "2026-11-10",
    items: [
      "Options sidebar now shows the SaveTabs logo, version, category icons, and a changelog link.",
      "Action buttons across settings and sync now include icons.",
      "Public changelog page with the release history.",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-11-10",
    items: [
      "Safari MV3 build ready for Xcode conversion.",
      "One-request sync snapshot with cached CORS preflights.",
      "Automatic startup sync now runs at most once every seven days.",
      "Saved-tab view selector plus one text area with every URL.",
      "One-click sync and a language picker in the popup.",
      "New FAQ, install guide, and generated visuals on the website.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-11-06",
    items: [
      "Optional accounts with an email, password, and wrapped sync key.",
      "End-to-end encrypted sync across devices.",
      "Web sessions viewer that decrypts locally in the browser.",
      "Twelve interface locales plus light, dark, and system themes.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-05",
    items: [
      "First public build: save and restore browser windows as sessions.",
      "Local-first storage with search, rename, and JSON export/import.",
      "Auto-discard on browsers that support tabs.discard.",
    ],
  },
];

export default function Changelog() {
  const { t } = useI18n();
  const latestVersion = RELEASES[0]?.version ?? "";

  useEffect(() => {
    const previous = document.title;
    document.title = `${t("web.changelog.title")} — SaveTabs`;
    return () => {
      document.title = previous;
    };
  }, [t]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <img
              src="/icon.svg"
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-lg"
            />
            SaveTabs
          </Link>
          <Link to="/" className={HEADER_CONTROL_CLASS}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("web.changelog.back")}
          </Link>
        </div>
      </header>

      <main className={`${SECTION_INNER_CLASS} max-w-4xl`}>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t("web.changelog.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-base text-neutral-600 dark:text-neutral-400">
          {t("web.changelog.subtitle")}
        </p>

        <ol className="mt-10 flex flex-col gap-5">
          {RELEASES.map((release, index) => {
            const latest = index === 0;
            return (
              <li
                key={release.version}
                className={`rounded-2xl border p-5 ${
                  latest
                    ? "border-indigo-300 bg-white shadow-lg shadow-indigo-600/10 dark:border-indigo-500/40 dark:bg-neutral-900"
                    : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold tabular-nums">
                    v{release.version}
                  </h2>
                  {release.version === latestVersion && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                      <Sparkles aria-hidden="true" className="size-3" />
                      {t("web.changelog.latest")}
                    </span>
                  )}
                  <time
                    dateTime={release.date}
                    className="text-sm text-neutral-500 dark:text-neutral-400"
                  >
                    {release.date}
                  </time>
                </div>
                <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                  {release.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}

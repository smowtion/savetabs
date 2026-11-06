import { LOCALES, type Lang } from "@savetabs/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { Link } from "react-router-dom";

import { AccountCta } from "../components/landing/AccountCta";
import { FeatureGrid } from "../components/landing/FeatureGrid";
import { Hero } from "../components/landing/Hero";
import { HowItWorks } from "../components/landing/HowItWorks";
import { InstallHelp } from "../components/landing/InstallHelp";
import { HEADER_CONTROL_CLASS } from "../components/landing/landing-styles";
import { PrivacySection } from "../components/landing/PrivacySection";
import { ScreenshotGallery } from "../components/landing/ScreenshotGallery";
import { SiteFooter } from "../components/landing/SiteFooter";
import { SyncKeyPanel } from "../components/landing/SyncKeyPanel";
import { TrustStrip } from "../components/landing/TrustStrip";
import { useI18n } from "../hooks/useI18n";
import { useTheme, type WebThemePreference } from "../hooks/useTheme";
import { loadAccountToken } from "../lib/account-session";

/**
 * Public landing page.
 *
 * Sections follow the product spec: hero with install actions, how it works,
 * privacy, features, account actions, the key-only entry path, install help
 * and the footer. Account creation and sign-in are the primary paths; the
 * sync-key form stays reachable as a secondary path through the account
 * section anchor.
 *
 * All copy comes from the shared dictionaries. The page makes no memory or
 * performance claims and the copy avoids percentage signs.
 */

const THEME_ICONS: Record<
  WebThemePreference,
  typeof Monitor | typeof Sun | typeof Moon
> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** Native language menu styled to match the other header controls. */
const LANGUAGE_SELECT_CLASS =
  "h-9 min-w-0 max-w-28 cursor-pointer rounded-lg border border-neutral-300 bg-white px-1 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

export default function Landing() {
  const { lang, t, setLang } = useI18n();
  const { preference, toggleTheme } = useTheme();
  // A signed-in visitor goes straight to account settings; everyone else is
  // sent to the sign-in page.
  const accountPath = loadAccountToken() !== null ? "/account" : "/login";

  const ThemeIcon = THEME_ICONS[preference];
  const themeLabel = `${t("web.theme.toggle")}: ${t(
    `web.theme.${preference}`,
  )}`;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-200/80 bg-neutral-50/85 backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-950/85">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
            <img
              src="/icon.svg"
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-lg"
            />
            SaveTabs
          </span>

          <div className="flex min-w-0 items-center gap-2">
            <select
              aria-label={t("web.language.toggle")}
              value={lang}
              onChange={(event) => setLang(event.target.value as Lang)}
              className={LANGUAGE_SELECT_CLASS}
            >
              {LOCALES.map((locale) => (
                <option key={locale.code} value={locale.code}>
                  {locale.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={themeLabel}
              className={HEADER_CONTROL_CLASS}
            >
              <ThemeIcon aria-hidden="true" size={16} />
            </button>
            <Link to={accountPath} className={HEADER_CONTROL_CLASS}>
              {t("web.landing.header.account")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Hero t={t} />
        <TrustStrip t={t} />
        <ScreenshotGallery t={t} />
        <HowItWorks t={t} />
        <PrivacySection t={t} />
        <FeatureGrid t={t} />
        <AccountCta t={t} />
        <SyncKeyPanel t={t} />
        <InstallHelp t={t} />
      </main>

      <SiteFooter t={t} />
    </div>
  );
}

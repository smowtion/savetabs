import type { Translator } from "@savetabs/shared";
import {
  HardDrive,
  History,
  KeyRound,
  Languages,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { Link } from "react-router-dom";

import { GitHubIcon } from "./GitHubIcon";
import { MUTED_TEXT_CLASS } from "./landing-styles";
import {
  CHROME_STORE_URL,
  FIREFOX_STORE_URL,
  GITHUB_URL,
  SUPPORT_EMAIL,
} from "./store-links";

/**
 * Site footer.
 *
 * A brand column with the tagline and trust highlights, then link groups for
 * the store listings and project resources. Every link carries an icon so the
 * footer stays scannable; the bottom bar keeps the copyright and privacy link.
 */

type Props = { t: Translator; accountPath: string };

const FOOTER_LINK_CLASS =
  "inline-flex items-center gap-2 rounded-sm text-sm text-neutral-600 transition hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-neutral-400 dark:hover:text-neutral-100";

const COLUMN_TITLE_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

const TRUST_ITEM_CLASS =
  "inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400";

export function SiteFooter({ t, accountPath }: Props) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm sm:col-span-2 lg:col-span-1">
            <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
              <img
                src="/icon.svg"
                alt=""
                width={28}
                height={28}
                className="size-7 rounded-lg"
              />
              SaveTabs
            </span>
            <p className={`mt-3 ${MUTED_TEXT_CLASS}`}>
              {t("web.landing.hero.title")}
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              <li className={TRUST_ITEM_CLASS}>
                <HardDrive aria-hidden="true" className="size-3.5" />
                {t("web.landing.trust.localFirst")}
              </li>
              <li className={TRUST_ITEM_CLASS}>
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {t("web.landing.trust.encrypted")}
              </li>
              <li className={TRUST_ITEM_CLASS}>
                <Languages aria-hidden="true" className="size-3.5" />
                {t("web.landing.trust.languages")}
              </li>
            </ul>
          </div>

          <nav aria-labelledby="footer-product-heading">
            <h2 id="footer-product-heading" className={COLUMN_TITLE_CLASS}>
              {t("web.landing.footer.product")}
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              <li>
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={FOOTER_LINK_CLASS}
                >
                  <img
                    src="/icons/chrome.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="size-4"
                  />
                  {t("web.landing.footer.store")}
                </a>
              </li>
              <li>
                <a
                  href={FIREFOX_STORE_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={FOOTER_LINK_CLASS}
                >
                  <img
                    src="/icons/firefox.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="size-4"
                  />
                  {t("web.landing.footer.firefoxStore")}
                </a>
              </li>
              <li>
                <Link to="/changelog" className={FOOTER_LINK_CLASS}>
                  <History aria-hidden="true" className="size-4" />
                  {t("web.landing.footer.changelog")}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-resources-heading">
            <h2 id="footer-resources-heading" className={COLUMN_TITLE_CLASS}>
              {t("web.landing.footer.resources")}
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={FOOTER_LINK_CLASS}
                >
                  <GitHubIcon className="size-4" />
                  GitHub
                </a>
              </li>
              <li>
                <a href="#use-sync-key" className={FOOTER_LINK_CLASS}>
                  <KeyRound aria-hidden="true" className="size-4" />
                  {t("web.landing.title")}
                </a>
              </li>
              <li>
                <Link to={accountPath} className={FOOTER_LINK_CLASS}>
                  <User aria-hidden="true" className="size-4" />
                  {t("web.landing.header.account")}
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className={FOOTER_LINK_CLASS}
                >
                  <Mail aria-hidden="true" className="size-4" />
                  {SUPPORT_EMAIL}
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} SaveTabs</p>
          <Link to="/privacy" className={FOOTER_LINK_CLASS}>
            <ShieldCheck aria-hidden="true" className="size-4" />
            {t("web.landing.footer.privacy")}
          </Link>
        </div>
      </div>
    </footer>
  );
}

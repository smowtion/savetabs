import { createTranslator } from "@savetabs/shared";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Fragment, useEffect } from "react";
import { Link } from "react-router-dom";

/**
 * Privacy policy for the web app and the browser extension.
 *
 * The content is intentionally explicit about what the sync server can see:
 * derived identifiers, an auth-key hash, encrypted blobs, timestamps and
 * deletion tombstones. For the optional account it documents the email, the
 * password-derived proof hash, the wrapped sync key, hashed tokens, the email
 * processor and the recovery-key limitation. It also states the consequences
 * of losing the sync key and where the "delete all cloud data" action lives,
 * because the store listings link here.
 *
 * The policy is published in English only. Other locales link here and read
 * the English text, so the page pins the English translator regardless of the
 * language chosen elsewhere in the app, and says that English prevails.
 *
 * All strings come from the shared dictionaries, and the page loads no
 * third-party resources so the production CSP stays limited to 'self'.
 */

/** The policy is not translated; every visitor reads the English version. */
const t = createTranslator("en");

/** Sections rendered in order; `data` adds the stored-items bullet list. */
const SECTIONS = [
  "data",
  "e2ee",
  "incognito",
  "keyLoss",
  "delete",
  "analytics",
  "contact",
] as const;

/** Individual values the sync server stores, keyed by i18n suffix. */
const DATA_ITEMS = [
  "authId",
  "authKeyHash",
  "blobs",
  "tombstones",
  "timestamps",
] as const;

/** Data disclosed when the visitor creates the optional account. */
const ACCOUNT_ITEMS = [
  "accountEmail",
  "accountProof",
  "accountVault",
  "accountTokens",
  "processorResend",
  "recoveryLimit",
  "unverifiedCleanup",
] as const;

const BODY_TEXT_CLASS =
  "mt-2 text-pretty text-sm leading-6 text-neutral-600 dark:text-neutral-400";

/** The optional-account disclosure, rendered after the sync-key data. */
function AccountSection() {
  return (
    <section aria-labelledby="privacy-account">
      <h2 id="privacy-account" className="text-lg font-semibold tracking-tight">
        {t("web.privacy.account.title")}
      </h2>
      <ul className="mt-2 list-disc space-y-2 ps-5 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        {ACCOUNT_ITEMS.map((item) => (
          <li key={item}>{t(`web.privacy.account.${item}`)}</li>
        ))}
      </ul>
    </section>
  );
}

export default function Privacy() {
  // The page is English-only, so it also resets the document attributes when
  // the visitor arrives from a right-to-left locale through client routing.
  useEffect(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
  }, []);

  return (
    <div
      lang="en"
      dir="ltr"
      className="flex min-h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-400"
          >
            <ArrowLeft
              aria-hidden="true"
              size={16}
              className="rtl:rotate-180"
            />
            {t("web.privacy.back")}
          </Link>
          <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white">
              <ShieldCheck aria-hidden="true" size={18} />
            </span>
            SaveTabs
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          {t("web.privacy.title")}
        </h1>
        <p className="mt-3 text-pretty text-base text-neutral-600 dark:text-neutral-400">
          {t("web.privacy.intro")}
        </p>
        <p
          role="note"
          className="mt-4 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
        >
          {t("web.privacy.notice")}
        </p>

        <div className="mt-10 space-y-9">
          {SECTIONS.map((section) => (
            <Fragment key={section}>
              <section aria-labelledby={`privacy-${section}`}>
                <h2
                  id={`privacy-${section}`}
                  className="text-lg font-semibold tracking-tight"
                >
                  {t(`web.privacy.sections.${section}.title`)}
                </h2>

                {section === "data" ? (
                  <>
                    <p className={BODY_TEXT_CLASS}>
                      {t("web.privacy.sections.data.lead")}
                    </p>
                    <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                      {DATA_ITEMS.map((item) => (
                        <li key={item}>
                          {t(`web.privacy.sections.data.${item}`)}
                        </li>
                      ))}
                    </ul>
                    <p className={BODY_TEXT_CLASS}>
                      {t("web.privacy.sections.data.footer")}
                    </p>
                  </>
                ) : (
                  <p className={BODY_TEXT_CLASS}>
                    {t(`web.privacy.sections.${section}.body`)}
                  </p>
                )}
              </section>
              {section === "data" ? <AccountSection /> : null}
            </Fragment>
          ))}
        </div>
      </main>
    </div>
  );
}

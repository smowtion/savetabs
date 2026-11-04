/**
 * "Update available" banner shared by the popup and the options page.
 *
 * The banner reads the state persisted by the background update check and
 * stays in sync while the page is open. Clicking the action opens the store
 * listing for the browser this build targets; a failure is logged and leaves
 * the banner in place so the user can retry.
 */

import type { Translator } from "@savetabs/shared";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import {
  LATEST_VERSION_STORAGE_KEY,
  UPDATE_AVAILABLE_STORAGE_KEY,
  currentBrowser,
  readUpdateState,
  storeListingUrl,
  type UpdateState,
} from "../lib/version-check";

const NO_UPDATE: UpdateState = { updateAvailable: false, latestVersion: null };

/** Persisted update state, refreshed whenever the background writes it. */
function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(NO_UPDATE);

  useEffect(() => {
    let active = true;

    const refresh = async (): Promise<void> => {
      const next = await readUpdateState();
      if (active) setState(next);
    };

    void refresh();
    const handleStorageChange: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, areaName) => {
      if (areaName !== "local") return;
      if (
        !(UPDATE_AVAILABLE_STORAGE_KEY in changes) &&
        !(LATEST_VERSION_STORAGE_KEY in changes)
      ) {
        return;
      }
      void refresh();
    };
    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      active = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  return state;
}

export function UpdateBanner({
  t,
  className = "",
}: {
  t: Translator;
  className?: string;
}) {
  const { updateAvailable, latestVersion } = useUpdateState();

  if (!updateAvailable || latestVersion === null) return null;

  async function openStoreListing(): Promise<void> {
    try {
      await browser.tabs.create({
        url: storeListingUrl(currentBrowser()),
      });
    } catch (error) {
      console.error("[savetabs] failed to open the store listing", error);
    }
  }

  return (
    <section
      aria-label={t("update.title")}
      className={`rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200 ${className}`}
    >
      <p className="font-semibold">{t("update.title")}</p>
      <p className="mt-0.5">
        {t("update.message", { version: latestVersion })}
      </p>
      <button
        type="button"
        onClick={() => void openStoreListing()}
        className="mt-1.5 rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-blue-700"
      >
        {t("update.action")}
      </button>
    </section>
  );
}

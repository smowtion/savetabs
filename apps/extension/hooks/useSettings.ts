/**
 * React bridge to the extension settings store.
 *
 * The store remains the single source of truth. This hook loads it once,
 * follows cross-context changes through `onSettingsChanged`, and after a
 * successful write refreshes the local snapshot from the pending store state
 * so controls react immediately instead of waiting for the debounced write.
 */

import type { Settings } from "@savetabs/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadSettings,
  onSettingsChanged,
  saveSetting,
  type SettingValue,
} from "../lib/settings";

/** How long the "Saved" indicator stays visible after a write. */
export const SAVED_INDICATOR_MS = 1500;

export type UseSettingsResult = {
  /** Null until the first load completes; then a complete settings object. */
  settings: Settings | null;
  /** True briefly after a successful setting write. */
  saved: boolean;
  /** Validate, stage and persist one setting through the shared store. */
  updateSetting: (key: string, value: SettingValue) => Promise<void>;
};

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaved = useCallback((): void => {
    setSaved(true);
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      savedTimer.current = null;
      setSaved(false);
    }, SAVED_INDICATOR_MS);
  }, []);

  useEffect(() => {
    let active = true;

    void loadSettings().then((next) => {
      if (active) setSettings(next);
    });
    const unsubscribe = onSettingsChanged((next) => {
      if (!active) return;
      setSettings(next);
      showSaved();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [showSaved]);

  useEffect(() => {
    return () => {
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    };
  }, []);

  const updateSetting = useCallback(
    async (key: string, value: SettingValue): Promise<void> => {
      await saveSetting(key, value);
      // Read the pending store state so the UI updates before the debounce.
      setSettings(await loadSettings());
    },
    [],
  );

  return { settings, saved, updateSetting };
}

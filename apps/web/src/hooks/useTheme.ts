import { useCallback, useEffect, useState } from "react";

/**
 * Theme preference for the web app.
 *
 * `system` follows the operating system through `prefers-color-scheme`;
 * `light` and `dark` are explicit. The preference is stored under its own
 * `web-theme` key so it never overlaps the extension's settings storage. The
 * resolved value is written to `<html data-theme>` for Tailwind's custom dark
 * variant.
 */

export type WebThemePreference = "system" | "light" | "dark";
export type ResolvedWebTheme = "light" | "dark";

/** Local preference key; intentionally separate from extension settings. */
export const THEME_STORAGE_KEY = "web-theme";

const THEME_CYCLE: readonly WebThemePreference[] = ["system", "light", "dark"];

function isThemePreference(value: string | null): value is WebThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredTheme(): WebThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function storeTheme(preference: WebThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this page.
  }
}

/** Return the next preference in the system -> light -> dark cycle. */
export function nextThemePreference(
  current: WebThemePreference,
): WebThemePreference {
  const index = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length] as WebThemePreference;
}

export function useTheme(): {
  preference: WebThemePreference;
  setPreference: (preference: WebThemePreference) => void;
  toggleTheme: () => void;
} {
  const [preference, setPreferenceState] =
    useState<WebThemePreference>(readStoredTheme);

  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const apply = (): void => {
      const resolved: ResolvedWebTheme =
        preference === "system"
          ? media?.matches
            ? "dark"
            : "light"
          : preference;
      document.documentElement.dataset.theme = resolved;
    };

    apply();
    if (media !== null) {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    return undefined;
  }, [preference]);

  const setPreference = useCallback((next: WebThemePreference) => {
    setPreferenceState(next);
    storeTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(nextThemePreference(preference));
  }, [preference, setPreference]);

  return { preference, setPreference, toggleTheme };
}

/**
 * Apply the resolved theme to `<html data-theme>`.
 *
 * When the preference is `system`, the media query is observed so theme
 * changes made in the operating system are reflected immediately. The
 * preference itself is never copied into local state; it comes from settings.
 */

import { useEffect } from "react";

import { resolveTheme, type ThemePreference } from "../lib/theme";

/** Media query used by the `system` theme preference. */
export const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      document.documentElement.dataset.theme = resolveTheme(preference, false);
      return;
    }

    const media = window.matchMedia(DARK_MODE_QUERY);
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(
        preference,
        media.matches,
      );
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
}

/**
 * Theme preference resolution shared by the options page and any future
 * extension surface.
 *
 * The stored setting is `system`, `light` or `dark`. The UI applies the
 * resolved value to `<html data-theme>`, so CSS never has to know whether the
 * user picked an explicit theme or is following the operating system.
 */

/** Values stored in the `general.theme` setting. */
export type ThemePreference = "system" | "light" | "dark";

/** Value written to the `data-theme` attribute. */
export type ResolvedTheme = "light" | "dark";

/** Toggle order used by the options header theme button. */
const THEME_CYCLE: readonly ThemePreference[] = ["system", "light", "dark"];

/** Coerce any stored value into a valid preference. */
export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** Resolve a stored preference to the concrete theme to render. */
export function resolveTheme(
  preference: unknown,
  prefersDark: boolean,
): ResolvedTheme {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "system") return prefersDark ? "dark" : "light";
  return normalized;
}

/** Return the next preference in the system -> light -> dark cycle. */
export function nextThemePreference(current: unknown): ThemePreference {
  const index = THEME_CYCLE.indexOf(normalizeThemePreference(current));
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]!;
}

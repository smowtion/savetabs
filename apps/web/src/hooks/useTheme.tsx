import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme preference for the web app.
 *
 * `system` follows the operating system through `prefers-color-scheme`;
 * `light` and `dark` are explicit. The preference is stored under its own
 * `web-theme` key so it never overlaps the extension's settings storage. The
 * resolved value is written to `<html data-theme>` for Tailwind's custom dark
 * variant.
 *
 * `App` mounts a single {@link ThemeProvider} so every route applies the stored
 * theme. `useTheme` keeps working when a component is rendered on its own (for
 * example in a focused test) by falling back to local state.
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

export type ThemeControls = {
  preference: WebThemePreference;
  setPreference: (preference: WebThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeControls | null>(null);

/**
 * Own the theme preference and apply it to the document.
 *
 * `active` is false for the inert fallback `useTheme` creates while a provider
 * supplies the shared controls, so only one instance writes `data-theme`.
 */
function useThemeState(active = true): ThemeControls {
  const [preference, setPreferenceState] =
    useState<WebThemePreference>(readStoredTheme);

  useEffect(() => {
    if (!active) return undefined;

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
  }, [preference, active]);

  const setPreference = useCallback((next: WebThemePreference) => {
    setPreferenceState(next);
    storeTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(nextThemePreference(preference));
  }, [preference, setPreference]);

  return { preference, setPreference, toggleTheme };
}

/** Share one theme preference with every route below it. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const controls = useThemeState();
  return (
    <ThemeContext.Provider value={controls}>{children}</ThemeContext.Provider>
  );
}

/**
 * Theme controls for the current component.
 *
 * Inside `App` this reads the shared provider state, so a toggle on any page
 * updates the document and every other consumer. Without a provider it owns
 * local state and behaves exactly as before.
 */
export function useTheme(): ThemeControls {
  const controls = useContext(ThemeContext);
  // Always call the fallback hook so hook order stays stable; it is inert
  // whenever a provider is present.
  const fallback = useThemeState(controls === null);
  return controls ?? fallback;
}

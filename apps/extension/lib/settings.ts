/**
 * Settings store backed by `chrome.storage.local`.
 *
 * Reads always merge persisted values over `DEFAULT_SETTINGS` and validate
 * every field individually, so corrupt storage (wrong types, unknown keys,
 * failed reads) can never throw or leak invalid values into the extension.
 *
 * Writes persist the complete settings object. Rapid `saveSetting` calls are
 * debounced into a single storage write so the options UI can update controls
 * freely without hammering storage.
 */

import {
  DEFAULT_SETTINGS,
  getSettingDef,
  validateSettings,
  type Settings,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

/** Storage key holding the complete settings object. */
export const SETTINGS_STORAGE_KEY = "settings";
/** Storage key holding the settings schema version written with each save. */
export const SETTINGS_VERSION_KEY = "settingsVersion";
/** Current settings schema version. */
export const SETTINGS_VERSION = 1;
/** Delay used to coalesce rapid setting changes into one write. */
export const SETTINGS_SAVE_DEBOUNCE_MS = 200;

export type SettingValue = Settings[string];
export type SettingsChangedListener = (settings: Settings) => void;

/** Thrown when a setting key is unknown or its value fails schema validation. */
export class InvalidSettingError extends Error {
  constructor(
    readonly key: string,
    readonly reason: string,
  ) {
    super(`Invalid setting "${key}": ${reason}`);
    this.name = "InvalidSettingError";
  }
}

function cloneSettingValue(value: SettingValue): SettingValue {
  return Array.isArray(value) ? [...value] : value;
}

function cloneSettings(settings: Settings): Settings {
  const copy: Settings = {};
  for (const [key, value] of Object.entries(settings)) {
    copy[key] = cloneSettingValue(value);
  }
  return copy;
}

/**
 * Turn any stored value into a complete, schema-valid settings object.
 * Unknown keys and invalid fields fall back to their defaults.
 */
function sanitizeSettings(raw: unknown): Settings {
  const merged = cloneSettings(DEFAULT_SETTINGS);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return merged;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!getSettingDef(key)) continue;
    const validated = validateSettings({ [key]: value });
    if (validated.ok) merged[key] = cloneSettingValue(validated.value[key]);
  }

  // Guard against a schema whose defaults are themselves invalid.
  const final = validateSettings(merged);
  return final.ok ? final.value : cloneSettings(DEFAULT_SETTINGS);
}

async function readStoredSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(stored[SETTINGS_STORAGE_KEY]);
  } catch {
    // Corrupt or unavailable storage must never break the extension.
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

let pendingSettings: Settings | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Serializes save staging. Without this, two saves started in the same tick
 * would both read storage before either stages its value, and the later write
 * would silently drop the earlier change.
 */
let stagingQueue: Promise<void> = Promise.resolve();

async function writeSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({
    [SETTINGS_STORAGE_KEY]: cloneSettings(settings),
    [SETTINGS_VERSION_KEY]: SETTINGS_VERSION,
  });
}

async function persistPendingSettings(): Promise<void> {
  const settings = pendingSettings;
  if (settings === null) return;
  pendingSettings = null;
  try {
    await writeSettings(settings);
  } catch (error) {
    // Debounced writes cannot report failures to a caller; keep the extension
    // running with the in-memory value and surface the problem in the console.
    console.error("[savetabs] failed to persist settings", error);
  }
}

function cancelPendingWrite(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingSettings = null;
}

function schedulePersistedWrite(settings: Settings): void {
  pendingSettings = settings;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void persistPendingSettings();
  }, SETTINGS_SAVE_DEBOUNCE_MS);
}

/**
 * Load the effective settings: defaults merged with any valid stored values.
 * Pending, not-yet-flushed saves take precedence over storage.
 */
export async function loadSettings(): Promise<Settings> {
  if (pendingSettings !== null) return cloneSettings(pendingSettings);
  return readStoredSettings();
}

/**
 * Validate and stage a single setting change. The complete settings object is
 * persisted after a short debounce; invalid keys or values throw
 * `InvalidSettingError` and leave the store untouched.
 */
export function saveSetting(
  key: string,
  value: SettingValue,
): Promise<void> {
  const result = stagingQueue.then(() => stageSettingChange(key, value));
  // Keep the queue alive after a rejection so later valid saves still run.
  stagingQueue = result.catch(() => undefined);
  return result;
}

async function stageSettingChange(
  key: string,
  value: SettingValue,
): Promise<void> {
  if (!getSettingDef(key)) {
    throw new InvalidSettingError(key, "unknown setting");
  }

  const validated = validateSettings({ [key]: value });
  if (!validated.ok) {
    throw new InvalidSettingError(key, validated.errors.join("; "));
  }

  const next = await loadSettings();
  next[key] = cloneSettingValue(validated.value[key]);
  schedulePersistedWrite(next);
}

/**
 * Restore every setting to its default immediately. Sessions and other
 * storage keys are left untouched.
 */
export function resetSettings(): Promise<void> {
  const result = stagingQueue.then(async () => {
    cancelPendingWrite();
    await writeSettings(cloneSettings(DEFAULT_SETTINGS));
  });
  // Keep the queue alive after a rejection so later saves still run.
  stagingQueue = result.catch(() => undefined);
  return result;
}

/**
 * Listen for settings changes from other extension contexts. The callback
 * receives a complete settings object with invalid values replaced by
 * defaults. Returns an unsubscribe function.
 */
export function onSettingsChanged(
  listener: SettingsChangedListener,
): () => void {
  const handleStorageChange: Parameters<
    typeof browser.storage.onChanged.addListener
  >[0] = (changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[SETTINGS_STORAGE_KEY];
    if (!change) return;

    const next = sanitizeSettings(change.newValue);
    listener(cloneSettings(next));
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  return () => {
    browser.storage.onChanged.removeListener(handleStorageChange);
  };
}

/**
 * Settings file import and export.
 *
 * A settings file is a small JSON envelope around the complete settings
 * object. The envelope lets an import reject unrelated JSON before any field
 * is read, and the shared schema remains the single source of truth for
 * validation: unknown keys are dropped, missing keys fall back to defaults,
 * and one invalid field rejects the whole file so an import is never applied
 * partially.
 */

import { validateSettings, type Settings } from "@savetabs/shared";

export const SETTINGS_FILE_APP = "savetabs";
export const SETTINGS_FILE_KIND = "settings";
export const SETTINGS_FILE_VERSION = 1;

export type SettingsFile = {
  app: typeof SETTINGS_FILE_APP;
  kind: typeof SETTINGS_FILE_KIND;
  version: typeof SETTINGS_FILE_VERSION;
  /** ISO 8601 timestamp of the export. */
  exportedAt: string;
  settings: Settings;
};

export type SettingsImportResult =
  | { ok: true; settings: Settings }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Serialize every setting into the documented settings-file format. */
export function exportSettingsFile(settings: Settings): string {
  const file: SettingsFile = {
    app: SETTINGS_FILE_APP,
    kind: SETTINGS_FILE_KIND,
    version: SETTINGS_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Validate a settings file and return the complete settings object.
 *
 * Header problems and field errors are reported together as readable strings;
 * callers must not apply anything when `ok` is false.
 */
export function importSettingsFile(text: string): SettingsImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["File is not valid JSON"] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ["File must be a JSON object"] };
  }

  const errors: string[] = [];
  if (parsed.app !== SETTINGS_FILE_APP) {
    errors.push(`app must be "${SETTINGS_FILE_APP}"`);
  }
  if (parsed.kind !== SETTINGS_FILE_KIND) {
    errors.push(`kind must be "${SETTINGS_FILE_KIND}"`);
  }
  if (parsed.version !== SETTINGS_FILE_VERSION) {
    errors.push(`version must be ${SETTINGS_FILE_VERSION}`);
  }
  if (!isRecord(parsed.settings)) {
    errors.push("settings must be an object");
  }
  if (errors.length > 0) return { ok: false, errors };

  const validated = validateSettings(parsed.settings);
  return validated.ok
    ? { ok: true, settings: validated.value }
    : { ok: false, errors: validated.errors };
}

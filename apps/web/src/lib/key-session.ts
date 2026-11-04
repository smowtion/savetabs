import {
  deriveKeys,
  formatKey,
  parseKey,
  type DerivedKeys,
} from "@savetabs/shared";

/**
 * Storage for the user's sync key.
 *
 * The key is held in `sessionStorage` for the current tab by default. Checking
 * "Remember on this device" also writes it to `localStorage`, which survives
 * browser restarts on that device. Loading prefers the remembered copy so a
 * device-wide opt-in wins over a stale per-session entry.
 *
 * The key is never placed in the URL or logged. Callers derive the crypto
 * material with {@link deriveForWeb} and keep it in memory only.
 */

/** Key used in both Web Storage areas. */
export const KEY_STORAGE_KEY = "savetabs.sync-key";

type StorageName = "localStorage" | "sessionStorage";

function storage(name: StorageName): Storage | null {
  try {
    return window[name];
  } catch {
    // Storage can be disabled (for example by browser privacy settings).
    return null;
  }
}

/** Read a key from one storage area, dropping values that no longer parse. */
function readValidKey(name: StorageName): string | null {
  const area = storage(name);
  if (area === null) return null;

  let stored: string | null;
  try {
    stored = area.getItem(KEY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (stored === null) return null;

  try {
    return formatKey(parseKey(stored));
  } catch {
    try {
      area.removeItem(KEY_STORAGE_KEY);
    } catch {
      // Ignore cleanup failures; the value is still treated as absent.
    }
    return null;
  }
}

/**
 * Validate and store a key for the current session.
 *
 * When `remember` is true the key is also persisted to `localStorage`;
 * otherwise any previously remembered copy is removed. Returns the canonical
 * display form of the key.
 *
 * @throws InvalidKeyError when the key cannot be parsed.
 */
export function saveKeyForSession(key: string, remember = false): string {
  const canonical = formatKey(parseKey(key));

  storage("sessionStorage")?.setItem(KEY_STORAGE_KEY, canonical);
  const persistent = storage("localStorage");
  if (persistent !== null) {
    if (remember) persistent.setItem(KEY_STORAGE_KEY, canonical);
    else persistent.removeItem(KEY_STORAGE_KEY);
  }

  return canonical;
}

/** Whether a valid key is currently remembered on this device. */
export function isKeyRemembered(): boolean {
  return readValidKey("localStorage") !== null;
}

/**
 * Load the stored key, preferring the remembered copy over the session copy.
 * Returns `null` when neither storage holds a valid key.
 */
export function loadKey(): string | null {
  return readValidKey("localStorage") ?? readValidKey("sessionStorage");
}

/** Remove the key from both storage areas. */
export function clearKey(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      storage(name)?.removeItem(KEY_STORAGE_KEY);
    } catch {
      // Nothing else to clean up when storage is unavailable.
    }
  }
}

/**
 * Parse a user-entered key and derive the auth id, bearer auth key and
 * non-extractable content key. The derived material is returned to the
 * caller and is never persisted.
 */
export async function deriveForWeb(key: string): Promise<DerivedKeys> {
  return deriveKeys(parseKey(key));
}

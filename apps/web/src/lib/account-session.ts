/**
 * Account token storage and account API client for the web app.
 *
 * The account token is the opaque bearer for the account API. Unlike the sync
 * key, it does not decrypt anything, so it is kept in `localStorage` for the
 * whole browser session and across restarts. The client factory pins the
 * configured API base so pages never build URLs themselves.
 */

import { AccountClient } from "@savetabs/shared";

import { API_BASE } from "./config";

/** Key used in `localStorage` for the account bearer token. */
export const ACCOUNT_TOKEN_STORAGE_KEY = "savetabs.account-token";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage can be disabled (for example by browser privacy settings).
    return null;
  }
}

/** Store the account token for later authenticated requests. */
export function saveAccountToken(token: string): void {
  try {
    storage()?.setItem(ACCOUNT_TOKEN_STORAGE_KEY, token);
  } catch {
    // The caller still holds the token in memory for this page.
  }
}

/** Load the stored account token, or `null` when there is none. */
export function loadAccountToken(): string | null {
  try {
    const token = storage()?.getItem(ACCOUNT_TOKEN_STORAGE_KEY);
    return token === undefined || token === null || token === "" ? null : token;
  } catch {
    return null;
  }
}

/** Remove the stored account token on sign-out. */
export function clearAccountToken(): void {
  try {
    storage()?.removeItem(ACCOUNT_TOKEN_STORAGE_KEY);
  } catch {
    // Nothing else to clean up when storage is unavailable.
  }
}

/** Create a client bound to the configured account API. */
export function createAccountClient(): AccountClient {
  return new AccountClient(API_BASE);
}

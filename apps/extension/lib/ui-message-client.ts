/**
 * Client side of the typed runtime message contract.
 *
 * Extension pages send `UiMessage`s to the background service worker and
 * receive a `UiResponse` for every request. This module validates that reply
 * shape so a page never renders an unexpected payload as success, and throws a
 * dedicated error the page can translate instead of surfacing a raw TypeError.
 */

import { browser } from "wxt/browser";

import type { UiMessage, UiResponse } from "./messages";

/** True when a background reply matches the `UiResponse` contract. */
export function isUiResponse(value: unknown): value is UiResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { ok?: unknown; code?: unknown; data?: unknown };
  if (record.ok === true) return record.data !== undefined;
  if (record.ok === false) return typeof record.code === "string";
  return false;
}

/** Thrown when the background reply does not match the message contract. */
export class UnexpectedResponseError extends Error {
  constructor() {
    super("unexpected background response");
    this.name = "UnexpectedResponseError";
  }
}

/** Send one typed message and reject an unexpected background reply. */
export async function sendUiMessage(message: UiMessage): Promise<UiResponse> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (isUiResponse(response)) return response;
  throw new UnexpectedResponseError();
}

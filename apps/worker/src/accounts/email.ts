/**
 * Outbound email through Resend.
 *
 * Callers build the verification link and pass ready-made copy; this module
 * only moves a message to the provider.
 */

import type { Env } from "../env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "SaveTabs <noreply@azcom.dev>";

/** The fields Resend needs for a single transactional message. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Rendered copy for a transactional email. */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export type EmailFetch = typeof fetch;

/**
 * Post one message to Resend.
 *
 * Without `RESEND_API_KEY` (local development and tests) this resolves without
 * calling the network, so account flows keep working with email disabled.
 * `fetchImpl` is injectable so tests can assert the request offline.
 */
export async function sendEmail(
  env: Env,
  message: EmailMessage,
  fetchImpl: EmailFetch = fetch,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (apiKey === undefined || apiKey === "") return;

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM ?? DEFAULT_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  // Account routes keep their generic responses even when delivery fails, so
  // surface provider errors in the log instead of failing the request.
  if (!response.ok) {
    console.error("resend_send_failed", { status: response.status });
  }
}

/**
 * English reset copy.
 *
 * Reset links only exist for accounts without a vault, so the mail can be sent
 * before any key material exists. Task 15 adds the locale dictionaries.
 */
export function resetEmail(locale: string, link: string): EmailContent {
  // English is the only dictionary today, so every locale renders the same.
  void locale;

  const subject = "Reset your SaveTabs password";
  const html = [
    "<p>Set a new SaveTabs password by opening the link below.</p>",
    `<p><a href="${link}">Reset password</a></p>`,
    "<p>This link expires in 24 hours. If you did not request a reset, you can ignore this email.</p>",
  ].join("\n");
  const text = [
    "Set a new SaveTabs password by opening this link:",
    "",
    link,
    "",
    "This link expires in 24 hours. If you did not request a reset, you can ignore this email.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * English verification copy.
 *
 * `locale` is part of the signature so the account routes pass the stored
 * language already; the localized dictionaries arrive with the web locales.
 */
export function verificationEmail(locale: string, link: string): EmailContent {
  // English is the only dictionary today, so every locale renders the same.
  void locale;

  const subject = "Verify your SaveTabs email";
  const html = [
    "<p>Confirm your SaveTabs email address by opening the link below.</p>",
    `<p><a href="${link}">Verify email</a></p>`,
    "<p>This link expires in 24 hours. If you did not create a SaveTabs account, you can ignore this email.</p>",
  ].join("\n");
  const text = [
    "Confirm your SaveTabs email address by opening this link:",
    "",
    link,
    "",
    "This link expires in 24 hours. If you did not create a SaveTabs account, you can ignore this email.",
  ].join("\n");

  return { subject, html, text };
}

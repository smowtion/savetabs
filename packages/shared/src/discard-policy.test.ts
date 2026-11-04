import { describe, it, expect } from "vitest";
import { isDiscardEligible } from "./discard-policy";

it("discard eligibility keeps active/pinned/audible/discarded/excluded", () => {
  const base = { id: 1, active: false, pinned: false, audible: false, discarded: false, url: "https://a.com", lastActiveAt: 0 };
  const opts = { now: 31 * 60_000, timeoutMinutes: 30, keepPinned: true, keepAudible: true, excludedDomains: [] };
  expect(isDiscardEligible(base, opts)).toBe(true);
  expect(isDiscardEligible({ ...base, pinned: true }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, audible: true }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, url: "https://mail.google.com/x" }, { ...opts, excludedDomains: ["mail.google.com"] })).toBe(false);
});

const base = { id: 1, active: false, pinned: false, audible: false, discarded: false, url: "https://a.com", lastActiveAt: 0 };
const opts = { now: 31 * 60_000, timeoutMinutes: 30, keepPinned: true, keepAudible: true, excludedDomains: [] };

it("rejects the active tab and already discarded tabs", () => {
  expect(isDiscardEligible({ ...base, active: true }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, discarded: true }, opts)).toBe(false);
});

it("honours the keepPinned and keepAudible switches", () => {
  expect(isDiscardEligible({ ...base, pinned: true }, { ...opts, keepPinned: false })).toBe(true);
  expect(isDiscardEligible({ ...base, audible: true }, { ...opts, keepAudible: false })).toBe(true);
});

it("requires at least timeoutMinutes of inactivity", () => {
  expect(isDiscardEligible({ ...base, lastActiveAt: opts.now - 30 * 60_000 + 1 }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, lastActiveAt: opts.now - 30 * 60_000 }, opts)).toBe(true);
});

it("excludes an exact host and its subdomains but not look-alike hosts", () => {
  const excluded = { ...opts, excludedDomains: ["mail.google.com"] };
  expect(isDiscardEligible({ ...base, url: "https://mail.google.com/x" }, excluded)).toBe(false);
  expect(isDiscardEligible({ ...base, url: "https://inbox.mail.google.com/x" }, excluded)).toBe(false);
  expect(isDiscardEligible({ ...base, url: "https://notmail.google.com/x" }, excluded)).toBe(true);
  expect(isDiscardEligible({ ...base, url: "https://google.com/x" }, excluded)).toBe(true);
});

it("never excludes tabs with a missing or malformed URL", () => {
  const excluded = { ...opts, excludedDomains: ["a.com"] };
  expect(isDiscardEligible({ ...base, url: undefined }, excluded)).toBe(true);
  expect(isDiscardEligible({ ...base, url: "not a url" }, excluded)).toBe(true);
});

it("only excludes when the hostname matches, not the full URL or port", () => {
  const excluded = { ...opts, excludedDomains: ["a.com"] };
  expect(isDiscardEligible({ ...base, url: "https://a.com:8443/path?q=1" }, excluded)).toBe(false);
  expect(isDiscardEligible({ ...base, url: "https://a.com.example.org" }, excluded)).toBe(true);
});

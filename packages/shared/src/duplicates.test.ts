import { describe, it, expect } from "vitest";
import { normalizeUrl, dedupeTabs, isUrlAlreadySaved } from "./duplicates";
import type { SavedTab, Session } from "./types";

it("normalizes per mode", () => {
  expect(normalizeUrl("https://a.com/p?q=1#x", "exact")).toBe("https://a.com/p?q=1#x");
  expect(normalizeUrl("https://a.com/p?q=1#x", "ignore-hash")).toBe("https://a.com/p?q=1");
  expect(normalizeUrl("https://a.com/p?q=1#x", "ignore-query")).toBe("https://a.com/p#x");
});

it("preserves everything except the stripped part", () => {
  expect(normalizeUrl("https://Example.COM/p/", "exact")).toBe("https://Example.COM/p/");
  expect(normalizeUrl("https://Example.COM/p/?q=1#x", "ignore-hash")).toBe("https://Example.COM/p/?q=1");
  expect(normalizeUrl("https://Example.COM/p/?q=1#x", "ignore-query")).toBe("https://Example.COM/p/#x");
  expect(normalizeUrl("https://a.com/p#x?not-a-query", "ignore-query")).toBe("https://a.com/p#x?not-a-query");
});

it("does not throw on malformed URLs and falls back to the raw string", () => {
  expect(normalizeUrl("not a url", "ignore-hash")).toBe("not a url");
  expect(normalizeUrl("not a url#x", "ignore-hash")).toBe("not a url#x");
  expect(normalizeUrl("not a url?q=1#x", "ignore-query")).toBe("not a url?q=1#x");
  expect(normalizeUrl("://bad", "exact")).toBe("://bad");
});

it("keeps the first occurrence when deduping", () => {
  const tabs: SavedTab[] = [
    { url: "https://a.com/p?q=1#x", title: "first" },
    { url: "https://a.com/p?q=1#y", title: "second" },
    { url: "https://a.com/p?q=2#x", title: "third" },
  ];
  expect(dedupeTabs(tabs, "exact").map((tab) => tab.title)).toEqual(["first", "second", "third"]);
  expect(dedupeTabs(tabs, "ignore-hash").map((tab) => tab.title)).toEqual(["first", "third"]);
  expect(dedupeTabs(tabs, "ignore-query").map((tab) => tab.title)).toEqual(["first", "second"]);
  expect(tabs).toHaveLength(3);
});

it("returns an empty array when there is nothing to dedupe", () => {
  expect(dedupeTabs([], "ignore-hash")).toEqual([]);
});

const sessions: Session[] = [
  {
    id: "s1",
    createdAt: 0,
    updatedAt: 0,
    source: "window",
    tabs: [{ url: "https://a.com/p?q=1#x", title: "A" }],
  },
  {
    id: "s2",
    createdAt: 0,
    updatedAt: 0,
    source: "tab",
    tabs: [{ url: "https://b.com", title: "B" }],
  },
];

it("finds a saved URL across all provided sessions using the match mode", () => {
  expect(isUrlAlreadySaved("https://a.com/p?q=2#x", sessions, "ignore-query")).toBe(true);
  expect(isUrlAlreadySaved("https://a.com/p?q=1#y", sessions, "ignore-hash")).toBe(true);
  expect(isUrlAlreadySaved("https://b.com", sessions, "exact")).toBe(true);
  expect(isUrlAlreadySaved("https://b.com/", sessions, "exact")).toBe(false);
  expect(isUrlAlreadySaved("https://a.com/p?q=2#y", sessions, "ignore-hash")).toBe(false);
  expect(isUrlAlreadySaved("https://c.com", sessions, "exact")).toBe(false);
});

it("compares raw strings for malformed URLs", () => {
  const odd: Session[] = [
    {
      id: "s3",
      createdAt: 0,
      updatedAt: 0,
      source: "tab",
      tabs: [{ url: "not a url#x", title: "odd" }],
    },
  ];
  expect(isUrlAlreadySaved("not a url#x", odd, "ignore-hash")).toBe(true);
  expect(isUrlAlreadySaved("not a url#y", odd, "ignore-hash")).toBe(false);
});

it("reports false when there are no sessions", () => {
  expect(isUrlAlreadySaved("https://a.com", [], "exact")).toBe(false);
});

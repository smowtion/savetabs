import { describe, it, expect } from "vitest";
import { formatTabsForClipboard } from "./clipboard";

it("formats all clipboard modes", () => {
  const tabs = [{ url: "https://a.com", title: "A" }];
  expect(formatTabsForClipboard(tabs, "plain-urls")).toBe("https://a.com");
  expect(formatTabsForClipboard(tabs, "markdown")).toBe("- [A](https://a.com)");
  expect(formatTabsForClipboard(tabs, "titled")).toBe("A\nhttps://a.com");
});

it("separates multiple tabs per format", () => {
  const tabs = [
    { url: "https://a.com", title: "A" },
    { url: "https://b.com", title: "B" },
  ];
  expect(formatTabsForClipboard(tabs, "plain-urls")).toBe("https://a.com\nhttps://b.com");
  expect(formatTabsForClipboard(tabs, "markdown")).toBe("- [A](https://a.com)\n- [B](https://b.com)");
  expect(formatTabsForClipboard(tabs, "titled")).toBe("A\nhttps://a.com\n\nB\nhttps://b.com");
});

it("returns an empty string for no tabs", () => {
  expect(formatTabsForClipboard([], "plain-urls")).toBe("");
  expect(formatTabsForClipboard([], "markdown")).toBe("");
  expect(formatTabsForClipboard([], "titled")).toBe("");
});

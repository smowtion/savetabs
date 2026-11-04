import {
  DEFAULT_SETTINGS,
  LIMITS,
  type Session,
  type Settings,
} from "@savetabs/shared";
import { describe, expect, it } from "vitest";

import { collectTabsForSave, type TabLike } from "./tab-collector";

function settingsWith(overrides: Settings = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeSession(
  id: string,
  tabs: readonly { url: string; title?: string }[],
): Session {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    source: "window",
    tabs: tabs.map((tab) => ({ url: tab.url, title: tab.title ?? tab.url })),
  };
}

function collect(tabs: readonly TabLike[], settings: Settings = settingsWith()) {
  return collectTabsForSave(tabs, { settings, existingSessions: [] });
}

describe("collectTabsForSave", () => {
  it("filters non-restorable schemes and pinned", () => {
    const settings = settingsWith({ "pinned.skipOnSave": true });
    const tabs: TabLike[] = [
      { url: "https://a.com", title: "A" },
      { url: "chrome://settings" },
      { url: "https://b.com", title: "B", pinned: true },
      { url: "file:///tmp/x" },
    ];

    const res = collectTabsForSave(tabs, { settings, existingSessions: [] });

    expect(res.tabs.map((tab) => tab.url)).toEqual(["https://a.com"]);
    expect(res.skipped).toBe(3);
  });

  it("keeps only http(s) URLs and counts every other tab as skipped", () => {
    const tabs: TabLike[] = [
      { url: "https://ok.example" },
      { url: "http://ok.example" },
      { url: "chrome://newtab" },
      { url: "edge://settings" },
      { url: "about:blank" },
      { url: "chrome-extension://abc/page.html" },
      { url: "devtools://devtools/bundled/inspector.html" },
      { url: "file:///tmp/notes.txt" },
      { url: "ftp://files.example/x" },
      { url: "data:text/plain,hi" },
      { title: "no url" },
      { url: "not a url" },
    ];

    const res = collect(tabs);

    expect(res.tabs.map((tab) => tab.url)).toEqual([
      "https://ok.example",
      "http://ok.example",
    ]);
    expect(res.skipped).toBe(10);
  });

  it("includes file URLs only when tabs.includeFileUrls is enabled", () => {
    const tabs: TabLike[] = [{ url: "file:///tmp/notes.txt" }];

    expect(collect(tabs).tabs).toEqual([]);
    expect(
      collect(tabs, settingsWith({ "tabs.includeFileUrls": true })).tabs.map(
        (tab) => tab.url,
      ),
    ).toEqual(["file:///tmp/notes.txt"]);
  });

  it("skips auditory tabs only when tabs.skipAudible is enabled", () => {
    const tabs: TabLike[] = [
      { url: "https://music.example", audible: true },
      { url: "https://quiet.example" },
    ];

    expect(
      collect(tabs, settingsWith({ "tabs.skipAudible": true })).tabs.map(
        (tab) => tab.url,
      ),
    ).toEqual(["https://quiet.example"]);
    expect(collect(tabs).tabs).toHaveLength(2);
  });

  it("keeps pinned tabs when pinned.skipOnSave is disabled", () => {
    const tabs: TabLike[] = [
      { url: "https://pinned.example", pinned: true },
      { url: "https://regular.example" },
    ];

    const res = collect(tabs, settingsWith({ "pinned.skipOnSave": false }));

    expect(res.tabs.map((tab) => tab.url)).toEqual([
      "https://pinned.example",
      "https://regular.example",
    ]);
    expect(res.tabs[0]?.pinned).toBe(true);
  });

  it("normalizes excluded domains and matches exact hosts and subdomains", () => {
    const settings = settingsWith({
      "tabs.excludedDomains": ["  .Example.COM.  ", "", "bank.example"],
    });
    const tabs: TabLike[] = [
      { url: "https://example.com/a" },
      { url: "https://news.example.com/b" },
      { url: "https://bank.example/secure" },
      { url: "https://notexample.com/c" },
      { url: "https://example.com.evil.net/d" },
    ];

    const res = collect(tabs, settings);

    expect(res.tabs.map((tab) => tab.url)).toEqual([
      "https://notexample.com/c",
      "https://example.com.evil.net/d",
    ]);
    expect(res.skipped).toBe(3);
  });

  it("removes in-batch duplicates using the configured match mode", () => {
    const settings = settingsWith({
      "duplicates.removeOnSave": true,
      "duplicates.matchMode": "ignore-hash",
    });
    const tabs: TabLike[] = [
      { url: "https://a.com/page#one" },
      { url: "https://a.com/page#two" },
      { url: "https://b.com" },
    ];

    const res = collect(tabs, settings);

    expect(res.tabs.map((tab) => tab.url)).toEqual([
      "https://a.com/page#one",
      "https://b.com",
    ]);
    expect(res.skipped).toBe(1);
  });

  it("keeps duplicates when duplicates.removeOnSave is disabled", () => {
    const tabs: TabLike[] = [
      { url: "https://a.com/page" },
      { url: "https://a.com/page" },
    ];

    const res = collect(
      tabs,
      settingsWith({ "duplicates.removeOnSave": false }),
    );

    expect(res.tabs).toHaveLength(2);
    expect(res.skipped).toBe(0);
  });

  it("skips URLs already stored in existing sessions when enabled", () => {
    const settings = settingsWith({
      "duplicates.skipAlreadySaved": true,
      "duplicates.matchMode": "ignore-hash",
    });
    const existingSessions = [
      makeSession("s1", [
        { url: "https://a.com" },
        { url: "https://b.com/page#x" },
      ]),
    ];
    const tabs: TabLike[] = [
      { url: "https://a.com" },
      { url: "https://b.com/page#y" },
      { url: "https://c.com" },
    ];

    const res = collectTabsForSave(tabs, { settings, existingSessions });

    expect(res.tabs.map((tab) => tab.url)).toEqual(["https://c.com"]);
    expect(res.skipped).toBe(2);
  });

  it("does not consult existing sessions when skipAlreadySaved is disabled", () => {
    const existingSessions = [makeSession("s1", [{ url: "https://a.com" }])];

    const res = collectTabsForSave(
      [{ url: "https://a.com" }],
      { settings: settingsWith(), existingSessions },
    );

    expect(res.tabs.map((tab) => tab.url)).toEqual(["https://a.com"]);
    expect(res.skipped).toBe(0);
  });

  it("caps at the shared tab limit and counts overflow as skipped", () => {
    const tabs: TabLike[] = Array.from(
      { length: LIMITS.maxTabsPerSession + 120 },
      (_, index) => ({
        url: `https://site.example/${index}`,
        title: `Tab ${index}`,
      }),
    );

    const res = collect(tabs);

    expect(res.tabs).toHaveLength(LIMITS.maxTabsPerSession);
    expect(res.skipped).toBe(120);
  });

  it("preserves tab metadata and falls back to the URL for missing titles", () => {
    const settings = settingsWith({ "pinned.skipOnSave": false });
    const tabs: TabLike[] = [
      {
        url: "https://a.com",
        title: "Alpha",
        favIconUrl: "https://a.com/favicon.ico",
        pinned: true,
      },
      { url: "https://b.com" },
    ];

    const res = collect(tabs, settings);

    expect(res.tabs[0]).toEqual({
      url: "https://a.com",
      title: "Alpha",
      favIconUrl: "https://a.com/favicon.ico",
      pinned: true,
    });
    expect(res.tabs[1]?.title).toBe("https://b.com");
  });

  it("drops favicons that reach 2 KB and keeps smaller remote icons", () => {
    const prefix = "data:image/png;base64,";
    const atLimit = prefix + "A".repeat(2 * 1024 - prefix.length);
    const belowLimit = prefix + "A".repeat(2 * 1024 - prefix.length - 1);

    const res = collect([
      { url: "https://remote.example", favIconUrl: "https://remote.example/icon.png" },
      { url: "https://small.example", favIconUrl: belowLimit },
      { url: "https://large.example", favIconUrl: atLimit },
    ]);

    expect(res.tabs[0]?.favIconUrl).toBe("https://remote.example/icon.png");
    expect(res.tabs[1]?.favIconUrl).toBe(belowLimit);
    expect(res.tabs[2]?.favIconUrl).toBeUndefined();
  });

  it("does not mutate the input tabs", () => {
    const tabs: TabLike[] = [
      { url: "https://a.com", title: "A" },
      { url: "https://a.com", title: "A" },
    ];
    const snapshot = tabs.map((tab) => ({ ...tab }));

    collect(tabs);

    expect(tabs).toEqual(snapshot);
  });
});

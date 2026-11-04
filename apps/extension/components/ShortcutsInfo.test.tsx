import { createTranslator } from "@savetabs/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHORTCUTS_PAGE_PATH,
  ShortcutsInfo,
  listShortcuts,
} from "./ShortcutsInfo";

const t = createTranslator("en");

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fakeBrowser.reset();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
  Reflect.deleteProperty(document, "execCommand");
});

describe("listShortcuts", () => {
  it("maps browser commands and omits empty bindings", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => [
      { name: "save-tabs", description: "", shortcut: "Alt+Shift+S" },
      { name: "open-sessions", description: "", shortcut: "" },
    ]);

    await expect(listShortcuts()).resolves.toEqual([
      { name: "save-tabs", shortcut: "Alt+Shift+S" },
      { name: "open-sessions" },
    ]);
  });

  it("returns no commands when the browser call fails", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockRejectedValue(
      new Error("commands unavailable"),
    );

    await expect(listShortcuts()).resolves.toEqual([]);
  });
});

describe("ShortcutsInfo", () => {
  it("lists the real bindings returned by commands.getAll", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => [
      { name: "save-tabs", description: "", shortcut: "Alt+Shift+S" },
      { name: "open-sessions", description: "", shortcut: "" },
      { name: "discard-now", description: "", shortcut: "Alt+Shift+D" },
    ]);

    render(<ShortcutsInfo t={t} />);

    const table = await screen.findByRole("table", {
      name: "Keyboard shortcuts for SaveTabs",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Command" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Shortcut" }),
    ).toBeInTheDocument();

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);

    expect(
      within(table).getByText("Save all tabs in the current window"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Alt+Shift+S")).toBeInTheDocument();
    expect(within(table).getByText("Open the sessions page")).toBeInTheDocument();
    expect(within(table).getByText("Not set")).toBeInTheDocument();
    expect(
      within(table).getByText("Discard inactive tabs now"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Alt+Shift+D")).toBeInTheDocument();
  });

  it("falls back to the raw name for an unknown command", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => [
      { name: "custom-action", description: "", shortcut: "Ctrl+K" },
    ]);

    render(<ShortcutsInfo t={t} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("custom-action")).toBeInTheDocument();
    expect(within(table).getByText("Ctrl+K")).toBeInTheDocument();
  });

  it("shows the shortcuts page path and copies it", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => []);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<ShortcutsInfo t={t} />);

    expect(
      await screen.findByText(
        "To change a shortcut, open the shortcuts page below and edit the shortcut for SaveTabs.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(SHORTCUTS_PAGE_PATH)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(SHORTCUTS_PAGE_PATH);
    expect(
      screen.getByText("Path copied to the clipboard."),
    ).toBeInTheDocument();
  });

  it("reports a failed copy instead of pretending it worked", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => []);
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    render(<ShortcutsInfo t={t} />);

    await screen.findByText(SHORTCUTS_PAGE_PATH);
    await userEvent.click(screen.getByRole("button", { name: "Copy path" }));

    expect(
      await screen.findByText("Could not copy the path."),
    ).toBeInTheDocument();
  });

  it("keeps the instructions visible when the commands API fails", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockRejectedValue(
      new Error("commands unavailable"),
    );

    render(<ShortcutsInfo t={t} />);

    expect(
      await screen.findByText(
        "To change a shortcut, open the shortcuts page below and edit the shortcut for SaveTabs.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

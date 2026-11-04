import { SETTINGS_SCHEMA, SETTING_KEYS } from "@savetabs/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_SECTIONS_STORAGE_KEY } from "../../lib/open-sections";
import { resetSettings } from "../../lib/settings";
import { App } from "./App";

function stubMatchMedia(matches = false): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  await resetSettings();
  fakeBrowser.reset();
  document.documentElement.removeAttribute("data-theme");
  stubMatchMedia();
});

afterEach(() => {
  cleanup();
  fakeBrowser.reset();
});

function main(): HTMLElement {
  return screen.getByRole("main");
}

describe("options shell", () => {
  it("starts with every section collapsed", () => {
    render(<App />);

    expect(
      within(main()).getAllByRole("button", { expanded: false }),
    ).toHaveLength(14);
  });

  it("expands and collapses every section, persisting the state", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(
      within(main()).getAllByRole("button", { expanded: true }),
    ).toHaveLength(14);
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get(
        OPEN_SECTIONS_STORAGE_KEY,
      );
      expect(stored[OPEN_SECTIONS_STORAGE_KEY]).toHaveLength(14);
    });

    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(
      within(main()).getAllByRole("button", { expanded: false }),
    ).toHaveLength(14);
  });

  it("restores persisted open sections", async () => {
    await fakeBrowser.storage.local.set({
      [OPEN_SECTIONS_STORAGE_KEY]: ["tabs", "not-real"],
    });

    render(<App />);

    const tabs = within(main()).getByRole("button", { name: /^Tabs/ });
    await waitFor(() =>
      expect(tabs).toHaveAttribute("aria-expanded", "true"),
    );
    expect(
      within(main()).getAllByRole("button", { expanded: true }),
    ).toHaveLength(1);
  });

  it("toggles one section and persists it", async () => {
    render(<App />);

    const memory = within(main()).getByRole("button", {
      name: /Memory saver/,
    });
    await userEvent.click(memory);

    expect(memory).toHaveAttribute("aria-expanded", "true");
    await waitFor(async () => {
      const stored = await fakeBrowser.storage.local.get(
        OPEN_SECTIONS_STORAGE_KEY,
      );
      expect(stored[OPEN_SECTIONS_STORAGE_KEY]).toEqual(["memory"]);
    });
  });

  it("cycles the theme and applies data-theme to the document", async () => {
    render(<App />);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await userEvent.click(
      screen.getByRole("button", { name: /Theme: System/ }),
    );
    const lightButton = await screen.findByRole("button", {
      name: /Theme: Light/,
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await userEvent.click(lightButton);
    await screen.findByRole("button", { name: /Theme: Dark/ });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await userEvent.click(screen.getByRole("button", { name: /Theme: Dark/ }));
    await screen.findByRole("button", { name: /Theme: System/ });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("filters sections by search, auto-expanding matches and clearing on Escape", async () => {
    render(<App />);

    const search = screen.getByRole("searchbox", {
      name: "Search settings",
    });
    await userEvent.type(search, "discard");

    expect(
      within(main()).queryByRole("button", { name: /General/ }),
    ).not.toBeInTheDocument();
    const memory = within(main()).getByRole("button", {
      name: /Memory saver/,
    });
    expect(memory).toHaveAttribute("aria-expanded", "true");
    expect(
      within(main()).getAllByRole("button", { expanded: true }),
    ).toHaveLength(1);

    await userEvent.keyboard("{Escape}");

    expect(search).toHaveValue("");
    await waitFor(() =>
      expect(
        within(main()).getByRole("button", { name: /General/ }),
      ).toBeInTheDocument(),
    );
  });

  it("shows a no-results message when the query matches nothing", async () => {
    render(<App />);

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search settings" }),
      "zzzz-no-match",
    );

    expect(
      screen.getByText("No settings match your search."),
    ).toBeInTheDocument();
    expect(
      within(main()).queryAllByRole("button", { expanded: false }),
    ).toHaveLength(0);
  });

  it("renders all 36 settings exactly once inside their category panels", () => {
    render(<App />);

    expect(SETTING_KEYS).toHaveLength(36);
    expect(screen.getAllByTestId(/^setting-/)).toHaveLength(36);

    for (const category of SETTINGS_SCHEMA) {
      const panel = document.getElementById(
        `settings-section-${category.id}-panel`,
      );
      expect(panel).not.toBeNull();
      for (const def of category.settings) {
        expect(
          within(panel as HTMLElement).getAllByTestId(`setting-${def.key}`),
        ).toHaveLength(1);
      }
    }
  });

  it("disables memory settings when the browser cannot discard tabs", async () => {
    const originalDiscard = fakeBrowser.tabs.discard;
    Object.defineProperty(fakeBrowser.tabs, "discard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      render(<App />);

      await userEvent.click(
        within(main()).getByRole("button", { name: /Memory saver/ }),
      );

      expect(
        await screen.findByRole("switch", {
          name: "Automatically discard inactive tabs",
        }),
      ).toBeDisabled();
      expect(
        screen.getAllByText(
          "Tab discarding is not available in this browser.",
        ),
      ).toHaveLength(4);
    } finally {
      Object.defineProperty(fakeBrowser.tabs, "discard", {
        value: originalDiscard,
        configurable: true,
        writable: true,
      });
    }
  });
});

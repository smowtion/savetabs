import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA,
  SETTING_KEYS,
  createTranslator,
  type CategoryId,
  type SettingDef,
  type Settings,
} from "@savetabs/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXTENSIONS_PAGE_PATH } from "../lib/incognito";
import {
  loadSettings,
  resetSettings,
  saveSetting,
  type SettingValue,
} from "../lib/settings";
import { CategorySection } from "./CategorySection";

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

function category(id: CategoryId) {
  const found = SETTINGS_SCHEMA.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unknown category: ${id}`);
  return found;
}

type HarnessProps = {
  categoryId: CategoryId;
  settings?: readonly SettingDef[];
  discardSupported?: boolean;
  initialValues?: Settings | null;
};

/**
 * Mirrors the options page wiring: controls call the store through the
 * `onChange` prop and the harness re-reads the store after each accepted
 * write. No setting value is kept anywhere except the store snapshot.
 */
function Harness({
  categoryId,
  settings = category(categoryId).settings,
  discardSupported = true,
  initialValues = DEFAULT_SETTINGS,
}: HarnessProps) {
  const [values, setValues] = useState<Settings | null>(initialValues);

  async function handleChange(key: string, value: SettingValue): Promise<void> {
    await saveSetting(key, value);
    setValues(await loadSettings());
  }

  return (
    <CategorySection
      categoryId={categoryId}
      settings={settings}
      values={values}
      t={t}
      onChange={handleChange}
      discardSupported={discardSupported}
    />
  );
}

beforeEach(async () => {
  fakeBrowser.reset();
  await resetSettings();
  fakeBrowser.reset();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await resetSettings();
  fakeBrowser.reset();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  }
  Reflect.deleteProperty(document, "execCommand");
});

describe("CategorySection", () => {
  it("renders every schema setting exactly once inside its own category", () => {
    render(
      <>
        {SETTINGS_SCHEMA.map((entry) => (
          <section key={entry.id} data-testid={`category-${entry.id}`}>
            <CategorySection
              categoryId={entry.id}
              settings={entry.settings}
              values={DEFAULT_SETTINGS}
              t={t}
              onChange={() => undefined}
              discardSupported
            />
          </section>
        ))}
      </>,
    );

    expect(SETTING_KEYS).toHaveLength(36);
    expect(screen.getAllByTestId(/^setting-/)).toHaveLength(36);

    for (const entry of SETTINGS_SCHEMA) {
      const container = screen.getByTestId(`category-${entry.id}`);
      for (const def of entry.settings) {
        expect(within(container).getAllByTestId(`setting-${def.key}`)).toHaveLength(
          1,
        );
        const row = within(container).getByTestId(`setting-${def.key}`);
        expect(
          within(row).getByRole("button", {
            name: `More information about ${t(def.labelKey)}`,
          }),
        ).toHaveAttribute("aria-describedby");
      }
    }
  });

  it("writes a toggle change through the settings store", async () => {
    render(<Harness categoryId="general" />);

    const toggle = screen.getByRole("switch", {
      name: "Show tab count badge",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeEnabled();

    await userEvent.click(toggle);

    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-checked", "false"),
    );
    await waitFor(
      async () => {
        const stored = (await fakeBrowser.storage.local.get(
          "settings",
        )) as { settings?: Settings };
        expect(stored.settings?.["general.showBadgeCount"]).toBe(false);
      },
      { timeout: 2000 },
    );
  });

  it("labels enum options from i18n", () => {
    render(<Harness categoryId="general" />);

    const theme = screen.getByRole("combobox", { name: "Theme" });
    expect(
      within(theme)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["System", "Light", "Dark"]);

    const language = screen.getByRole("combobox", { name: "Language" });
    expect(
      within(language)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Automatic", "English", "Vietnamese"]);
  });

  it("saves numeric enum values as numbers", async () => {
    render(<Harness categoryId="memory" />);

    const timeout = screen.getByRole("combobox", {
      name: "Inactivity timeout",
    });
    expect(
      within(timeout)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["5 minutes", "15 minutes", "30 minutes", "60 minutes", "120 minutes"]);

    await userEvent.selectOptions(timeout, "60");

    await waitFor(async () => {
      const settings = await loadSettings();
      expect(settings["memory.timeoutMinutes"]).toBe(60);
      expect(typeof settings["memory.timeoutMinutes"]).toBe("number");
    });
  });

  it("falls back to the raw value when an option label is missing", () => {
    const def: SettingDef = {
      key: "general.theme",
      type: "enum",
      values: ["system", "neon"],
      default: "system",
      labelKey: "settings.general.theme.label",
      descriptionKey: "settings.general.theme.description",
    };

    render(
      <CategorySection
        categoryId="general"
        settings={[def]}
        values={{ ...DEFAULT_SETTINGS, "general.theme": "system" }}
        t={t}
        onChange={() => undefined}
        discardSupported
      />,
    );

    expect(screen.getByRole("option", { name: "neon" })).toBeInTheDocument();
  });

  it("enforces number min/max, reverts invalid input and shows a hint", async () => {
    render(<Harness categoryId="general" />);

    const input = screen.getByRole("spinbutton", {
      name: "Confirm before closing many tabs",
    });
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "500");
    expect(input).toHaveAttribute("step", "1");

    await userEvent.clear(input);
    await userEvent.type(input, "9999");
    await userEvent.tab();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Enter a whole number between 0 and 500.",
      ),
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(input).toHaveValue(20));
    await expect(loadSettings()).resolves.toMatchObject({
      "general.confirmThreshold": 20,
    });

    await userEvent.clear(input);
    await userEvent.type(input, "50{Enter}");

    await waitFor(() => expect(input).toHaveValue(50));
    await waitFor(async () =>
      expect((await loadSettings())["general.confirmThreshold"]).toBe(50),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds normalized domains on Enter and comma, removes chips and rejects duplicates", async () => {
    render(<Harness categoryId="tabs" />);

    const input = screen.getByRole("textbox", { name: "Excluded domains" });

    await userEvent.type(input, "  Example.COM. {Enter}");
    await waitFor(() =>
      expect(screen.getByText("example.com")).toBeInTheDocument(),
    );
    await waitFor(async () =>
      expect((await loadSettings())["tabs.excludedDomains"]).toEqual([
        "example.com",
      ]),
    );

    await userEvent.type(input, "another.test,");
    await waitFor(() =>
      expect(screen.getByText("another.test")).toBeInTheDocument(),
    );
    await waitFor(async () =>
      expect((await loadSettings())["tabs.excludedDomains"]).toEqual([
        "example.com",
        "another.test",
      ]),
    );

    await userEvent.type(input, "EXAMPLE.com{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This entry is already in the list.",
    );
    await expect(loadSettings()).resolves.toMatchObject({
      "tabs.excludedDomains": ["example.com", "another.test"],
    });

    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value before adding it.",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove example.com" }),
    );
    await waitFor(async () =>
      expect((await loadSettings())["tabs.excludedDomains"]).toEqual([
        "another.test",
      ]),
    );
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
  });

  it("enforces the string-list maxItems limit", async () => {
    const def: SettingDef = {
      key: "tabs.excludedDomains",
      type: "string-list",
      default: [],
      maxItems: 2,
      labelKey: "settings.tabs.excludedDomains.label",
      descriptionKey: "settings.tabs.excludedDomains.description",
    };

    render(<Harness categoryId="tabs" settings={[def]} />);

    const input = screen.getByRole("textbox", { name: "Excluded domains" });

    await userEvent.type(input, "one.test{Enter}");
    await waitFor(() =>
      expect(screen.getByText("one.test")).toBeInTheDocument(),
    );
    await userEvent.type(input, "two.test{Enter}");
    await waitFor(() =>
      expect(screen.getByText("two.test")).toBeInTheDocument(),
    );
    await userEvent.type(input, "three.test{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You can add at most 2 items.",
    );
    await expect(loadSettings()).resolves.toMatchObject({
      "tabs.excludedDomains": ["one.test", "two.test"],
    });
    expect(screen.queryByText("three.test")).not.toBeInTheDocument();
  });

  it("disables memory settings with a note when discard is unsupported", () => {
    render(<Harness categoryId="memory" discardSupported={false} />);

    for (const name of [
      "Automatically discard inactive tabs",
      "Keep tabs playing audio",
      "Keep pinned tabs",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    expect(
      screen.getByRole("combobox", { name: "Inactivity timeout" }),
    ).toBeDisabled();
    expect(
      screen.getAllByText("Tab discarding is not available in this browser."),
    ).toHaveLength(4);
  });

  it("keeps memory settings enabled when discard is supported", () => {
    render(<Harness categoryId="memory" discardSupported />);

    expect(
      screen.getByRole("switch", { name: "Automatically discard inactive tabs" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "Inactivity timeout" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Tab discarding is not available in this browser."),
    ).not.toBeInTheDocument();
  });

  it("shows incognito access as allowed and keeps the setting enabled", async () => {
    vi.spyOn(
      fakeBrowser.extension,
      "isAllowedIncognitoAccess",
    ).mockImplementation(async () => true);

    render(<Harness categoryId="incognito" />);

    expect(await screen.findByText("Allowed")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Include incognito windows" }),
    ).toBeEnabled();
    expect(screen.queryByText("Not allowed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy path" }),
    ).not.toBeInTheDocument();
  });

  it("disables the incognito setting and explains how to allow access", async () => {
    vi.spyOn(
      fakeBrowser.extension,
      "isAllowedIncognitoAccess",
    ).mockImplementation(async () => false);

    render(<Harness categoryId="incognito" />);

    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Include incognito windows" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "This setting is disabled because SaveTabs is not allowed in incognito windows.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "To allow access, open the extensions page below, open the SaveTabs details, and allow the extension in private windows.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(EXTENSIONS_PAGE_PATH)).toBeInTheDocument();
  });

  it("copies the extensions page path when incognito access is denied", async () => {
    vi.spyOn(
      fakeBrowser.extension,
      "isAllowedIncognitoAccess",
    ).mockImplementation(async () => false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<Harness categoryId="incognito" />);

    await screen.findByText("Not allowed");
    await userEvent.click(screen.getByRole("button", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(EXTENSIONS_PAGE_PATH);
    expect(
      screen.getByText("Path copied to the clipboard."),
    ).toBeInTheDocument();
  });

  it("renders real command bindings in the shortcuts category", async () => {
    vi.spyOn(fakeBrowser.commands, "getAll").mockImplementation(async () => [
      { name: "save-tabs", description: "", shortcut: "Alt+Shift+S" },
    ]);

    render(<Harness categoryId="shortcuts" />);

    const table = await screen.findByRole("table", {
      name: "Keyboard shortcuts for SaveTabs",
    });
    expect(
      within(table).getByText("Save all tabs in the current window"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Alt+Shift+S")).toBeInTheDocument();
  });
});

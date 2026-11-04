import { createTranslator, SETTINGS_SCHEMA } from "@savetabs/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "./SettingsSidebar";

const t = createTranslator("en");

afterEach(() => {
  cleanup();
});

describe("SettingsSidebar", () => {
  it("lists all 14 categories in schema order with schema counts", () => {
    render(
      <SettingsSidebar
        activeCategory="general"
        onSelect={() => undefined}
        t={t}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Settings categories" });
    const buttons = within(nav).getAllByRole("button");

    expect(buttons).toHaveLength(SETTINGS_SCHEMA.length);
    buttons.forEach((button, index) => {
      const category = SETTINGS_SCHEMA[index]!;
      expect(button).toHaveTextContent(t(category.labelKey));
      expect(
        within(button).getByText(String(category.settings.length)),
      ).toBeInTheDocument();
    });
  });

  it("marks only the active category with aria-current and reports selections", async () => {
    const onSelect = vi.fn();
    render(
      <SettingsSidebar activeCategory="memory" onSelect={onSelect} t={t} />,
    );

    const nav = screen.getByRole("navigation", { name: "Settings categories" });
    const buttons = within(nav).getAllByRole("button");
    const activeButtons = buttons.filter((button) =>
      button.hasAttribute("aria-current"),
    );

    expect(activeButtons).toHaveLength(1);
    expect(activeButtons[0]).toHaveTextContent("Memory saver");
    expect(activeButtons[0]).toHaveAttribute("aria-current", "page");

    await userEvent.click(within(nav).getByRole("button", { name: /Tabs/ }));
    expect(onSelect).toHaveBeenCalledWith("tabs");
  });

  it("offers the same categories in the compact dropdown", async () => {
    const onSelect = vi.fn();
    render(
      <SettingsSidebar activeCategory="general" onSelect={onSelect} t={t} />,
    );

    const select = screen.getByRole("combobox", {
      name: "Settings categories",
    });
    expect(within(select).getAllByRole("option")).toHaveLength(
      SETTINGS_SCHEMA.length,
    );
    expect(select).toHaveValue("general");

    await userEvent.selectOptions(select, "sync");
    expect(onSelect).toHaveBeenCalledWith("sync");
  });
});

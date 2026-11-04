import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SettingRow, settingControlId } from "./SettingRow";
import { Toggle } from "./Toggle";

afterEach(() => {
  cleanup();
});

describe("SettingRow", () => {
  it("renders one row with a label, description and the control", () => {
    const controlId = settingControlId("general.showBadgeCount");

    render(
      <SettingRow
        settingKey="general.showBadgeCount"
        label="Show tab count badge"
        description="Display the number of open tabs on the toolbar icon."
        tooltip={{
          text: "Display the number of open tabs on the toolbar icon.",
          label: "More information about Show tab count badge",
        }}
      >
        <Toggle
          id={controlId}
          checked
          label="Show tab count badge"
          onChange={() => undefined}
        />
      </SettingRow>,
    );

    expect(screen.getAllByTestId("setting-general.showBadgeCount")).toHaveLength(
      1,
    );

    const row = screen.getByTestId("setting-general.showBadgeCount");
    const label = within(row).getByText("Show tab count badge");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", controlId);
    const descriptionNodes = within(row).getAllByText(
      "Display the number of open tabs on the toolbar icon.",
    );
    expect(descriptionNodes.some((node) => node.tagName === "P")).toBe(true);
    expect(
      within(row).getByRole("switch", { name: "Show tab count badge" }),
    ).toHaveAttribute("id", controlId);
  });

  it("exposes the tooltip through an accessible info button", async () => {
    render(
      <SettingRow
        settingKey="general.theme"
        label="Theme"
        description="Choose light, dark, or follow the system appearance."
        tooltip={{
          text: "Choose light, dark, or follow the system appearance.",
          label: "More information about Theme",
        }}
      >
        <Toggle
          id={settingControlId("general.theme")}
          checked={false}
          label="Theme"
          onChange={() => undefined}
        />
      </SettingRow>,
    );

    const info = screen.getByRole("button", {
      name: "More information about Theme",
    });
    const tooltipId = info.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveAttribute(
      "id",
      tooltipId,
    );
    expect(screen.getByRole("tooltip", { hidden: true })).not.toBeVisible();

    await userEvent.click(info);

    expect(screen.getByRole("tooltip")).toBeVisible();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Choose light, dark, or follow the system appearance.",
    );
  });

  it("omits the info button when no tooltip is supplied and shows notes", () => {
    render(
      <SettingRow
        settingKey="memory.autoDiscard"
        label="Automatically discard inactive tabs"
        description="Free memory by discarding inactive tabs."
        note="Tab discarding is not available in this browser."
        disabled
      >
        <Toggle
          id={settingControlId("memory.autoDiscard")}
          checked
          label="Automatically discard inactive tabs"
          disabled
          onChange={() => undefined}
        />
      </SettingRow>,
    );

    expect(screen.queryByRole("button", { name: /More information/ })).toBeNull();
    expect(
      screen.getByText("Tab discarding is not available in this browser."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Automatically discard inactive tabs",
      }),
    ).toBeDisabled();
  });
});

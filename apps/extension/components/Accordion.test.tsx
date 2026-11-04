import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Accordion } from "./Accordion";

afterEach(() => {
  cleanup();
});

function AccordionHarness() {
  const [open, setOpen] = useState(false);

  return (
    <Accordion
      categoryId="memory"
      title="Memory saver"
      description="Free memory by discarding inactive tabs."
      count={4}
      open={open}
      onToggle={setOpen}
    >
      <p>Setting rows</p>
    </Accordion>
  );
}

describe("Accordion", () => {
  it("renders the category label, setting count and description", () => {
    render(<AccordionHarness />);

    const header = screen.getByRole("button", { name: /Memory saver/ });
    expect(header).toHaveTextContent("Memory saver");
    expect(header).toHaveTextContent("4");
    expect(header).toHaveTextContent(
      "Free memory by discarding inactive tabs.",
    );
  });

  it("exposes aria-expanded and toggles the controlled panel", async () => {
    render(<AccordionHarness />);

    const header = screen.getByRole("button", { name: /Memory saver/ });
    const panel = document.getElementById("settings-section-memory-panel");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveAttribute(
      "aria-controls",
      "settings-section-memory-panel",
    );
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();

    await userEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(screen.getByText("Setting rows")).toBeVisible();

    await userEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  it("renders the panel open when controlled open is true", () => {
    render(
      <Accordion
        categoryId="tabs"
        title="Tabs"
        count={5}
        open
        onToggle={() => undefined}
      >
        <p>Rows</p>
      </Accordion>,
    );

    expect(
      screen.getByRole("button", { name: /Tabs/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Rows")).toBeVisible();
  });
});

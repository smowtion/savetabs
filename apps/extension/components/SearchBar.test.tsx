import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SearchBar } from "./SearchBar";

afterEach(() => {
  cleanup();
});

function SearchHarness() {
  const [value, setValue] = useState("");

  return (
    <SearchBar
      value={value}
      onChange={setValue}
      label="Search settings"
      placeholder="Search settings…"
    />
  );
}

describe("SearchBar", () => {
  it("renders a labelled search input", () => {
    render(<SearchHarness />);

    expect(
      screen.getByRole("searchbox", { name: "Search settings" }),
    ).toBeInTheDocument();
  });

  it("focuses the input on Ctrl+K or Cmd+K", () => {
    render(<SearchHarness />);
    const input = screen.getByRole("searchbox", {
      name: "Search settings",
    });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();

    input.blur();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(input).toHaveFocus();
  });

  it("clears the query on Escape", async () => {
    render(<SearchHarness />);
    const input = screen.getByRole("searchbox", {
      name: "Search settings",
    });

    await userEvent.type(input, "discard");
    expect(input).toHaveValue("discard");

    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });
});

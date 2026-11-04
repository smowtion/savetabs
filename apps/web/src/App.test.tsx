import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import App from "./App";
import { saveKeyForSession } from "./lib/key-session";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("App routing", () => {
  it("redirects to the landing page when no key is stored", () => {
    renderApp("/sessions");

    expect(
      screen.getByRole("heading", { name: "Open your saved tabs" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Your sessions will appear here."),
    ).not.toBeInTheDocument();
  });

  it("shows the sessions placeholder when a key is stored", () => {
    saveKeyForSession(VALID_KEY);

    renderApp("/sessions");

    expect(
      screen.getByText("Your sessions will appear here."),
    ).toBeInTheDocument();
  });

  it("allows the privacy page without a key", () => {
    renderApp("/privacy");

    expect(
      screen.getByText("The privacy policy is coming soon."),
    ).toBeInTheDocument();
  });
});

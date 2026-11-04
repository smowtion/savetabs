import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("App routing", () => {
  it("redirects to the landing page when no key is stored", () => {
    renderApp("/sessions");

    expect(
      screen.getByRole("heading", { name: "Open your saved tabs" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Saved sessions" }),
    ).not.toBeInTheDocument();
  });

  it("shows the sessions page when a key is stored", async () => {
    saveKeyForSession(VALID_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ blobs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    renderApp("/sessions");

    expect(
      await screen.findByRole("heading", { name: "Saved sessions" }),
    ).toBeInTheDocument();
  });

  it("shares the stored theme with every route and keeps the landing toggle working", async () => {
    localStorage.setItem("web-theme", "light");
    const user = userEvent.setup();

    renderApp("/");

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );

    await user.click(screen.getByRole("button", { name: /Change theme/i }));

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    expect(localStorage.getItem("web-theme")).toBe("dark");
  });

  it("allows the privacy page without a key", () => {
    renderApp("/privacy");

    expect(
      screen.getByText("The privacy policy is coming soon."),
    ).toBeInTheDocument();
  });
});

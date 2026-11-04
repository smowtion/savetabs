import { missingKeys } from "@savetabs/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import {
  KEY_STORAGE_KEY,
  loadKey,
  saveKeyForSession,
} from "../lib/key-session";
import Landing from "./Landing";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";

const WEB_TRANSLATION_KEYS = [
  "web.landing.title",
  "web.landing.description",
  "web.landing.keyLabel",
  "web.landing.keyPlaceholder",
  "web.landing.continue",
  "web.landing.invalidKey",
  "web.landing.loseKeyWarning",
  "web.landing.rememberLabel",
  "web.landing.rememberWarning",
  "web.landing.privacyLink",
  "web.language.toggle",
  "web.theme.toggle",
  "web.theme.system",
  "web.theme.light",
  "web.theme.dark",
];

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sessions" element={<div data-testid="sessions-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Landing", () => {
  it("renders the key entry form with title, description and warnings", () => {
    renderLanding();

    expect(
      screen.getByRole("heading", { name: "Open your saved tabs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/decrypted in your browser/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Sync key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be recovered/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    // The remembered-key warning is visible before the user opts in.
    expect(
      screen.getByText(/Only use this on a device you trust/i),
    ).toBeInTheDocument();
  });

  it("shows a localized error for an invalid key", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText("Sync key"), "not-a-key");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That sync key is not valid",
    );
    expect(screen.queryByTestId("sessions-page")).not.toBeInTheDocument();
    expect(loadKey()).toBeNull();
  });

  it("navigates to sessions after a valid key is entered", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText("Sync key"), VALID_KEY);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByTestId("sessions-page")).toBeInTheDocument();
    expect(loadKey()).toBe(VALID_KEY);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the key out of the URL after continuing", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText("Sync key"), VALID_KEY);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByTestId("sessions-page");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("stores the key in localStorage only when remember is checked", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText("Sync key"), VALID_KEY);
    await user.click(screen.getByLabelText("Remember on this device"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByTestId("sessions-page");
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
  });

  it("does not remember the key by default", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.type(screen.getByLabelText("Sync key"), VALID_KEY);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByTestId("sessions-page");
    expect(localStorage.getItem(KEY_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY_STORAGE_KEY)).toBe(VALID_KEY);
  });

  it("cycles and persists the theme preference", async () => {
    localStorage.setItem("web-theme", "light");
    const user = userEvent.setup();
    renderLanding();

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );

    await user.click(screen.getByRole("button", { name: /Change theme/i }));

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    expect(localStorage.getItem("web-theme")).toBe("dark");
  });

  it("switches the interface language and persists the choice", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole("button", { name: "Switch language" }));

    expect(
      await screen.findByRole("heading", { name: "Mở các tab đã lưu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeInTheDocument();
    expect(localStorage.getItem("web-language")).toBe("vi");
  });

  it("prefills a remembered key and shows the remember state", () => {
    saveKeyForSession(VALID_KEY, true);

    renderLanding();

    expect(screen.getByLabelText("Sync key")).toHaveValue(VALID_KEY);
    expect(screen.getByLabelText("Remember on this device")).toBeChecked();
  });

  it("has every web translation in both languages", () => {
    expect(missingKeys("en", WEB_TRANSLATION_KEYS)).toEqual([]);
    expect(missingKeys("vi", WEB_TRANSLATION_KEYS)).toEqual([]);
  });
});

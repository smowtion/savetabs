import { missingKeys } from "@savetabs/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  KEY_STORAGE_KEY,
  loadKey,
  saveKeyForSession,
} from "../lib/key-session";
import Landing from "./Landing";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";

/** The published Chrome Web Store listing. Firefox is not published yet. */
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi";

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
  "web.landing.header.account",
  "web.landing.hero.title",
  "web.landing.hero.description",
  "web.landing.hero.chrome",
  "web.landing.hero.firefox",
  "web.landing.hero.comingSoon",
  "web.landing.hero.noAccount",
  "web.landing.hero.mockup.save",
  "web.landing.hero.mockup.sessions",
  "web.landing.hero.mockup.sessionOne",
  "web.landing.hero.mockup.sessionTwo",
  "web.landing.hero.mockup.restore",
  "web.landing.hero.mockup.sync",
  "web.landing.howItWorks.title",
  "web.landing.howItWorks.steps.save.title",
  "web.landing.howItWorks.steps.save.body",
  "web.landing.howItWorks.steps.close.title",
  "web.landing.howItWorks.steps.close.body",
  "web.landing.howItWorks.steps.restore.title",
  "web.landing.howItWorks.steps.restore.body",
  "web.landing.privacy.title",
  "web.landing.privacy.items.e2ee.title",
  "web.landing.privacy.items.e2ee.body",
  "web.landing.privacy.items.keyOnly.title",
  "web.landing.privacy.items.keyOnly.body",
  "web.landing.privacy.items.localFirst.title",
  "web.landing.privacy.items.localFirst.body",
  "web.landing.privacy.items.privateWindows.title",
  "web.landing.privacy.items.privateWindows.body",
  "web.landing.privacy.link",
  "web.landing.features.title",
  "web.landing.features.items.search.title",
  "web.landing.features.items.search.body",
  "web.landing.features.items.rename.title",
  "web.landing.features.items.rename.body",
  "web.landing.features.items.exportImport.title",
  "web.landing.features.items.exportImport.body",
  "web.landing.features.items.autoDiscard.title",
  "web.landing.features.items.autoDiscard.body",
  "web.landing.features.items.sync.title",
  "web.landing.features.items.sync.body",
  "web.landing.features.items.privateWindows.title",
  "web.landing.features.items.privateWindows.body",
  "web.landing.account.title",
  "web.landing.account.description",
  "web.landing.account.create",
  "web.landing.account.signIn",
  "web.landing.account.useKey",
  "web.landing.install.title",
  "web.landing.install.items.install.title",
  "web.landing.install.items.install.body",
  "web.landing.install.items.uninstall.title",
  "web.landing.install.items.uninstall.body",
  "web.landing.install.items.troubleshooting.title",
  "web.landing.install.items.troubleshooting.body",
  "web.landing.footer.privacy",
  "web.landing.footer.store",
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
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
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

  it("renders one hero heading and the marketing sections", () => {
    renderLanding();

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/save every tab/i);

    expect(
      screen.getByRole("heading", { name: "How it works" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Privacy" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/end-to-end encrypted/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Features" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Install and troubleshooting" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.getByText(/support@azcom\.dev/)).toBeInTheDocument();
  });

  it("offers the Chrome install and a disabled Firefox button", () => {
    renderLanding();

    expect(
      screen.getByRole("link", { name: /add to chrome/i }),
    ).toHaveAttribute("href", CHROME_STORE_URL);

    const firefox = screen.getByRole("button", { name: /firefox/i });
    expect(firefox).toBeDisabled();
    expect(firefox).toHaveTextContent(/coming soon/i);
  });

  it("links the account actions and the sync-key path", () => {
    renderLanding();

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("link", { name: "Create account" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("link", { name: /use a sync key/i }),
    ).toHaveAttribute("href", "#use-sync-key");

    expect(
      screen
        .getByRole("heading", { name: "Open your saved tabs" })
        .closest("section"),
    ).toHaveAttribute("id", "use-sync-key");
  });

  it("keeps the key path available", () => {
    renderLanding();

    expect(screen.getByLabelText(/sync key/i)).toBeInTheDocument();
  });

  it("links every privacy reference to the policy page", () => {
    renderLanding();

    const privacyLinks = screen.getAllByRole("link", { name: /privacy/i });
    expect(privacyLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of privacyLinks) {
      expect(link).toHaveAttribute("href", "/privacy");
    }
  });

  it("shows the support address and the store listing in the footer", () => {
    renderLanding();

    expect(
      screen.getByRole("link", { name: "support@azcom.dev" }),
    ).toHaveAttribute("href", "mailto:support@azcom.dev");
    expect(
      screen.getByRole("link", { name: "Chrome Web Store" }),
    ).toHaveAttribute("href", CHROME_STORE_URL);
  });

  it("avoids percentage claims in the copy", () => {
    renderLanding();

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
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

  it("lists every supported language and persists the selection", async () => {
    const user = userEvent.setup();
    renderLanding();

    const select = screen.getByLabelText("Switch language");
    expect(select).toHaveValue("en");
    expect(screen.getAllByRole("option")).toHaveLength(12);
    expect(screen.getByRole("option", { name: "العربية" })).toHaveValue("ar");

    await user.selectOptions(select, "vi");

    expect(
      await screen.findByRole("heading", { name: "Mở các tab đã lưu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Lưu mọi tab",
    );
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeInTheDocument();
    expect(localStorage.getItem("web-language")).toBe("vi");
  });

  it("switches the document to right-to-left for Arabic", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.selectOptions(screen.getByLabelText("Switch language"), "ar");

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(
      await screen.findByRole("heading", {
        name: "افتح علامات التبويب المحفوظة",
      }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("web-language")).toBe("ar");
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

import { missingKeys } from "@savetabs/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  KEY_STORAGE_KEY,
  loadKey,
  saveKeyForSession,
} from "../lib/key-session";
import { saveAccountToken } from "../lib/account-session";
import Landing from "./Landing";

/** A syntactically valid key: ST- prefix plus 26 Crockford symbols. */
const VALID_KEY = "ST-00000-00000-00000-00000-00000-0";

/** The published store listings. Safari is not distributed yet. */
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi";
const FIREFOX_STORE_URL =
  "https://addons.mozilla.org/firefox/addon/save_tabs/";

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
  "web.landing.hero.safari",
  "web.landing.hero.comingSoon",
  "web.landing.hero.noAccount",
  "web.landing.hero.mockup.save",
  "web.landing.hero.mockup.sessions",
  "web.landing.hero.mockup.sessionOne",
  "web.landing.hero.mockup.sessionTwo",
  "web.landing.hero.mockup.restore",
  "web.landing.hero.mockup.sync",
  "web.landing.trust.label",
  "web.landing.trust.localFirst",
  "web.landing.trust.encrypted",
  "web.landing.trust.languages",
  "web.landing.trust.noAccount",
  "web.landing.gallery.title",
  "web.landing.gallery.subtitle",
  "web.landing.gallery.tabs.sessions",
  "web.landing.gallery.tabs.settings",
  "web.landing.gallery.tabs.popup",
  "web.landing.gallery.tabs.promo",
  "web.landing.gallery.tabs.privacy",
  "web.landing.gallery.captions.sessions",
  "web.landing.gallery.captions.settings",
  "web.landing.gallery.captions.popup",
  "web.landing.gallery.captions.promo",
  "web.landing.gallery.captions.privacy",
  "web.landing.guide.saveAlt",
  "web.landing.guide.restoreAlt",
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
  "web.landing.footer.firefoxStore",
  "web.landing.faq.title",
  "web.landing.faq.subtitle",
  "web.landing.faq.items.account.q",
  "web.landing.faq.items.account.a",
  "web.landing.faq.items.storage.q",
  "web.landing.faq.items.storage.a",
  "web.landing.faq.items.devices.q",
  "web.landing.faq.items.devices.a",
  "web.landing.faq.items.lostKey.q",
  "web.landing.faq.items.lostKey.a",
  "web.landing.faq.items.tabs.q",
  "web.landing.faq.items.tabs.a",
  "web.landing.faq.items.free.q",
  "web.landing.faq.items.free.a",
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
      screen.getByText(/If you lose it, your saved data cannot be recovered/i),
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
      screen.getByRole("heading", { name: "A closer look" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Privacy" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/end-to-end encrypted/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Features" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Install and troubleshooting" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/no account needed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/support@azcom\.dev/)).toBeInTheDocument();
  });

  it("uses the extension icon in the header and footer", () => {
    const { container } = renderLanding();

    const headerLogo = container.querySelector("header img");
    expect(headerLogo).toHaveAttribute("src", "/icon.svg");
    expect(headerLogo).toHaveAttribute("alt", "");
    expect(headerLogo).toHaveAttribute("width", "32");

    const footerLogo = container.querySelector("footer img");
    expect(footerLogo).toHaveAttribute("src", "/icon.svg");
    expect(footerLogo).toHaveAttribute("alt", "");
    expect(footerLogo).toHaveAttribute("width", "28");
  });

  it("shows the four trust chips under the hero", () => {
    renderLanding();

    const trust = screen.getByRole("list", { name: "Product highlights" });
    for (const label of [
      "Local-first",
      "End-to-end encrypted",
      "12 languages",
      "No account needed",
    ]) {
      expect(within(trust).getByText(label)).toBeInTheDocument();
    }
  });

  it("switches the screenshot gallery between its five tabs", async () => {
    const user = userEvent.setup();
    renderLanding();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("img", {
        name: "Save a whole window, then restore the exact tabs when you need them.",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Sessions" }));

    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("img", {
        name: "Each saved window becomes one session you can restore later.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("img", {
        name: "Save a whole window, then restore the exact tabs when you need them.",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    expect(
      screen.getByRole("img", {
        name: "Choose what gets saved, closed, and synced.",
      }),
    ).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Privacy & sync" }));
    expect(
      screen.getByRole("img", {
        name: "Private by default. Encrypted sync only when you turn it on.",
      }),
    ).toBeVisible();
  });

  it("moves the gallery selection with the arrow keys", async () => {
    const user = userEvent.setup();
    renderLanding();

    screen.getByRole("tab", { name: "Overview" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Popup" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Privacy & sync" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the generated visuals in the save, close and restore guide", () => {
    const { container } = renderLanding();

    for (const src of [
      "/images/guide-save.webp",
      "/images/guide-close.webp",
      "/images/guide-restore.webp",
    ]) {
      expect(container.querySelector(`img[src="${src}"]`)).toBeInTheDocument();
    }
  });

  it("links the Chrome and Firefox install buttons and disables Safari", () => {
    renderLanding();

    const chromeLinks = screen.getAllByRole("link", {
      name: /add to chrome/i,
    });
    expect(chromeLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of chromeLinks) {
      expect(link).toHaveAttribute("href", CHROME_STORE_URL);
    }

    const firefoxLinks = screen.getAllByRole("link", {
      name: /add to firefox/i,
    });
    expect(firefoxLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of firefoxLinks) {
      expect(link).toHaveAttribute("href", FIREFOX_STORE_URL);
    }

    const safariButtons = screen.getAllByRole("button", { name: /safari/i });
    expect(safariButtons.length).toBeGreaterThanOrEqual(1);
    for (const button of safariButtons) {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent(/coming soon/i);
    }
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

  it("points the header account link at the account page when signed in", () => {
    saveAccountToken("account-token");

    renderLanding();

    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/account",
    );
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

  it("shows the support address and both store listings in the footer", () => {
    renderLanding();

    expect(
      screen.getByRole("link", { name: "support@azcom.dev" }),
    ).toHaveAttribute("href", "mailto:support@azcom.dev");
    expect(
      screen.getByRole("link", { name: "Chrome Web Store" }),
    ).toHaveAttribute("href", CHROME_STORE_URL);
    expect(
      screen.getByRole("link", { name: "Firefox Add-ons" }),
    ).toHaveAttribute("href", FIREFOX_STORE_URL);
  });

  it("answers the first FAQ entry on demand", async () => {
    const user = userEvent.setup();
    renderLanding();

    const question = screen.getByText("Do I need an account?");
    expect(question).toBeInTheDocument();

    await user.click(question);

    expect(
      screen.getByText(/SaveTabs works locally and key-only sync needs no account/i),
    ).toBeVisible();
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

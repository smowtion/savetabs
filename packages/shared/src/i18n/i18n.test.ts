import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "../settings-schema";
import en from "./en.json";
import { createTranslator, missingKeys, resolveLang } from "./index";
import { LANGS, LOCALES, localeDir } from "./locales";

type JsonObject = { readonly [key: string]: string | JsonObject };

/** Flatten a dictionary into dotted keys, matching the runtime flattening. */
function flattenKeys(dictionary: JsonObject, prefix = ""): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flattenKeys(value, path);
  });
}

const ALL_EN_KEYS = flattenKeys(en as JsonObject);

/** Keys the policy page renders in English for every locale. */
function requiredKeys(locale: string): string[] {
  return locale === "en" || locale === "vi"
    ? ALL_EN_KEYS
    : ALL_EN_KEYS.filter((key) => !key.startsWith("web.privacy."));
}

describe("i18n", () => {
  it("registers the supported locales with their direction", () => {
    expect(LANGS).toEqual([
      "en",
      "vi",
      "zh-CN",
      "es",
      "hi",
      "ar",
      "pt",
      "ru",
      "ja",
      "fr",
      "de",
      "ko",
    ]);
    expect(LOCALES.map((locale) => locale.name)).toEqual([
      "English",
      "Tiếng Việt",
      "简体中文",
      "Español",
      "हिन्दी",
      "العربية",
      "Português",
      "Русский",
      "日本語",
      "Français",
      "Deutsch",
      "한국어",
    ]);
    for (const locale of LOCALES) expect(localeDir(locale.code)).toBe(locale.dir);
    expect(localeDir("ar")).toBe("rtl");
  });

  it("has every English key in every locale", () => {
    for (const locale of LANGS) {
      expect(missingKeys(locale, requiredKeys(locale)), locale).toEqual([]);
    }
  });

  it("resolves browser language prefixes", () => {
    expect(resolveLang("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveLang("auto", "es-419")).toBe("es");
    expect(resolveLang("auto", "hi-IN")).toBe("hi");
    expect(resolveLang("auto", "ar-EG")).toBe("ar");
    expect(resolveLang("auto", "pt-BR")).toBe("pt");
    expect(resolveLang("auto", "ru-RU")).toBe("ru");
    expect(resolveLang("auto", "ja-JP")).toBe("ja");
    expect(resolveLang("auto", "fr-CA")).toBe("fr");
    expect(resolveLang("auto", "de-DE")).toBe("de");
    expect(resolveLang("auto", "ko-KR")).toBe("ko");
    expect(resolveLang("auto", "xx")).toBe("en");
  });

  it("honors explicit language preferences over the browser", () => {
    expect(resolveLang("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLang("es", "vi-VN")).toBe("es");
    expect(resolveLang("hi", "en-US")).toBe("hi");
    expect(resolveLang("ar", "en-US")).toBe("ar");
    expect(resolveLang("pt", "ru-RU")).toBe("pt");
    expect(resolveLang("ru", "en-US")).toBe("ru");
    expect(resolveLang("de", "ko-KR")).toBe("de");
    expect(resolveLang("ko", "de-DE")).toBe("ko");
  });

  it("stores the policy only in English and Vietnamese", () => {
    const privacyKeys = ALL_EN_KEYS.filter((key) =>
      key.startsWith("web.privacy."),
    );
    const english = createTranslator("en");
    const englishOnlyLocales = LANGS.filter(
      (locale) => locale !== "en" && locale !== "vi",
    );

    expect(english("web.privacy.title")).toBe("Privacy policy");
    expect(english("web.privacy.notice")).toContain("English version prevails");
    // Vietnamese ships a full translation of the policy.
    expect(missingKeys("vi", privacyKeys)).toEqual([]);

    // Every other locale omits the policy because the page pins English, so
    // a stale English copy cannot drift from the canonical text.
    expect(englishOnlyLocales.length).toBeGreaterThan(0);
    for (const locale of englishOnlyLocales) {
      expect(missingKeys(locale, privacyKeys), locale).toEqual(privacyKeys);
      expect(createTranslator(locale)("web.privacy.title")).toBe(
        "web.privacy.title",
      );
    }
  });

  it("resolves language and covers every schema string", () => {
    expect(resolveLang("auto", "vi-VN")).toBe("vi");
    expect(resolveLang("auto", "en-US")).toBe("en");
    const needed = SETTINGS_SCHEMA.flatMap(c => [
      c.labelKey, ...c.settings.flatMap(s => [s.labelKey, s.descriptionKey]),
    ]);
    expect(missingKeys("en", needed)).toEqual([]);
    expect(missingKeys("vi", needed)).toEqual([]);
    expect(createTranslator("en")("common.tabsCount", { count: 3 })).toContain("3");
  });

  it("honors explicit language overrides", () => {
    expect(resolveLang("vi", "en-US")).toBe("vi");
    expect(resolveLang("en", "vi-VN")).toBe("en");
    expect(resolveLang("ja", "en-US")).toBe("ja");
    expect(resolveLang("fr", "en-US")).toBe("fr");
    expect(resolveLang("de", "en-US")).toBe("de");
    expect(resolveLang("ko", "en-US")).toBe("ko");
    expect(resolveLang("auto", "th-TH")).toBe("en");
  });

  it("falls back to the key itself for missing translations", () => {
    expect(createTranslator("en")("missing.key")).toBe("missing.key");
  });

  it("reports only the keys missing from a dictionary", () => {
    expect(missingKeys("vi", ["common.restore", "nope.missing"])).toEqual(["nope.missing"]);
  });

  it("covers the options shell strings in both languages", () => {
    const shellKeys = [
      "options.search",
      "options.searchPlaceholder",
      "options.expandAll",
      "options.collapseAll",
      "options.categories",
      "options.settingCount",
      "options.saved",
      "options.noResults",
      "options.theme.system",
      "options.theme.light",
      "options.theme.dark",
      "options.theme.toggle",
      ...SETTINGS_SCHEMA.map((category) => `settings.${category.id}.description`),
    ];

    expect(missingKeys("en", shellKeys)).toEqual([]);
    expect(missingKeys("vi", shellKeys)).toEqual([]);
  });

  it("labels every enum option in every language", () => {
    const optionKeys = SETTINGS_SCHEMA.flatMap((category) =>
      category.settings.flatMap((setting) =>
        setting.type === "enum"
          ? setting.values.map(
              (value) => `settings.option.${setting.key}.${String(value)}`,
            )
          : [],
      ),
    );

    expect(optionKeys.length).toBeGreaterThan(0);
    for (const locale of LANGS) {
      expect(missingKeys(locale, optionKeys), locale).toEqual([]);
    }
  });

  it("covers the advanced actions strings in both languages", () => {
    const advancedKeys = [
      "settings.advanced.storageUsage",
      "settings.advanced.storageNearLimit",
      "settings.advanced.exportSettings",
      "settings.advanced.importSettings",
      "settings.advanced.exportSessions",
      "settings.advanced.importSessions",
      "settings.advanced.resetToDefaults",
      "settings.advanced.clearSessions",
      "settings.advanced.sessionsPlaintextWarning",
      "settings.advanced.exportSuccess",
      "settings.advanced.importSettingsSuccess",
      "settings.advanced.importSettingsSyncStaysOff",
      "settings.advanced.importSettingsFailed",
      "settings.advanced.importSessionsSuccess",
      "settings.advanced.importSessionsPartial",
      "settings.advanced.importSessionsFailed",
      "settings.advanced.actionFailed",
      "settings.advanced.resetTitle",
      "settings.advanced.resetMessage",
      "settings.advanced.resetConfirm",
      "settings.advanced.resetSuccess",
      "settings.advanced.clearTitle",
      "settings.advanced.clearMessage",
      "settings.advanced.clearConfirm",
      "settings.advanced.clearSuccess",
    ];

    expect(missingKeys("en", advancedKeys)).toEqual([]);
    expect(missingKeys("vi", advancedKeys)).toEqual([]);
  });

  it("covers the sync key management strings in both languages", () => {
    const syncKeys = [
      "settings.sync.keyTitle",
      "settings.sync.keyLabel",
      "settings.sync.keyMaskedHint",
      "settings.sync.revealKey",
      "settings.sync.hideKey",
      "settings.sync.copyKey",
      "settings.sync.copied",
      "settings.sync.copyFailed",
      "settings.sync.importLabel",
      "settings.sync.importPlaceholder",
      "settings.sync.invalidKey",
      "settings.sync.importPrompt",
      "settings.sync.importPromptHint",
      "settings.sync.importUpload",
      "settings.sync.importSkip",
      "settings.sync.importSuccess",
      "settings.sync.importSkipped",
      "settings.sync.rotateKey",
      "settings.sync.rotateTitle",
      "settings.sync.rotateWarning",
      "settings.sync.rotateConfirmLabel",
      "settings.sync.rotateConfirmPlaceholder",
      "settings.sync.rotateConfirm",
      "settings.sync.rotateSuccess",
      "settings.sync.rotateSuccessRevoked",
      "settings.sync.rotateSuccessRevokeFailed",
      "settings.sync.loseKeyWarning",
      "settings.sync.onlyCredentialWarning",
      "settings.sync.accountPasswordLabel",
      "settings.sync.accountPasswordHint",
      "settings.sync.accountPasswordRequired",
      "settings.sync.keyRelinkFailed",
      "settings.sync.actionFailed",
    ];

    expect(missingKeys("en", syncKeys)).toEqual([]);
    expect(missingKeys("vi", syncKeys)).toEqual([]);
  });

  it("covers the sync status and cloud data strings in both languages", () => {
    const syncStatusKeys = [
      "settings.sync.statusTitle",
      "settings.sync.statusOn",
      "settings.sync.statusOff",
      "settings.sync.lastSyncLabel",
      "settings.sync.neverSynced",
      "settings.sync.pendingLabel",
      "settings.sync.syncing",
      "settings.sync.syncResult",
      "settings.sync.syncErrorsTitle",
      "settings.sync.authError",
      "settings.sync.deleteCloud",
      "settings.sync.deleteCloudTitle",
      "settings.sync.deleteCloudMessage",
      "settings.sync.deleteCloudConfirm",
      "settings.sync.deleteCloudSuccess",
      "settings.sync.enableConfirmTitle",
      "settings.sync.enableConfirmMessage",
      "settings.sync.enableConfirm",
    ];

    expect(missingKeys("en", syncStatusKeys)).toEqual([]);
    expect(missingKeys("vi", syncStatusKeys)).toEqual([]);
  });

  it("covers the incognito and shortcuts strings in both languages", () => {
    const categoryKeys = [
      "settings.incognito.status.label",
      "settings.incognito.status.allowed",
      "settings.incognito.status.denied",
      "settings.incognito.deniedNote",
      "settings.incognito.enableInstructions",
      "settings.incognito.pagePathLabel",
      "settings.incognito.copyPath",
      "settings.incognito.copySuccess",
      "settings.incognito.copyFailed",
      "settings.shortcuts.tableCaption",
      "settings.shortcuts.commandHeader",
      "settings.shortcuts.bindingHeader",
      "settings.shortcuts.notSet",
      "settings.shortcuts.instructions",
      "settings.shortcuts.pagePathLabel",
      "settings.shortcuts.copyPath",
      "settings.shortcuts.copySuccess",
      "settings.shortcuts.copyFailed",
      "settings.shortcuts.commandLabel.save-tabs",
      "settings.shortcuts.commandLabel.open-sessions",
      "settings.shortcuts.commandLabel.discard-now",
    ];

    expect(missingKeys("en", categoryKeys)).toEqual([]);
    expect(missingKeys("vi", categoryKeys)).toEqual([]);
  });

  it("covers the popup strings in both languages", () => {
    const popupKeys = [
      "popup.saveTabs",
      "popup.openSessions",
      "popup.syncOn",
      "popup.syncOff",
      "popup.discardOff",
      "popup.discardStatus",
      "popup.recentTitle",
      "popup.empty",
      "popup.restoreSession",
      "popup.loadFailed",
    ];

    expect(missingKeys("en", popupKeys)).toEqual([]);
    expect(missingKeys("vi", popupKeys)).toEqual([]);
  });

  it("covers the update banner strings in both languages", () => {
    const updateKeys = ["update.title", "update.message", "update.action"];

    expect(missingKeys("en", updateKeys)).toEqual([]);
    expect(missingKeys("vi", updateKeys)).toEqual([]);
    expect(
      createTranslator("en")("update.message", { version: "2.0.0" }),
    ).toContain("2.0.0");
    expect(
      createTranslator("vi")("update.message", { version: "2.0.0" }),
    ).toContain("2.0.0");
  });

  it("covers the sessions page strings in both languages", () => {
    const sessionKeys = [
      "sessions.title",
      "sessions.searchLabel",
      "sessions.searchPlaceholder",
      "sessions.saveWindow",
      "sessions.saveConfirmTitle",
      "sessions.saveConfirmMessage",
      "sessions.saveConfirm",
      "sessions.invalidResponse",
      "sessions.empty",
      "sessions.noResults",
      "sessions.private",
      "sessions.moreActions",
      "sessions.rename",
      "sessions.exportSession",
      "sessions.renameLabel",
      "sessions.renameSuccess",
      "sessions.restoreSuccess",
      "sessions.saveSuccess",
      "sessions.saveOverflow",
      "sessions.saveEmpty",
      "sessions.copySuccess",
      "sessions.copyFailed",
      "sessions.exportSuccess",
      "sessions.deleteTitle",
      "sessions.deleteMessage",
      "sessions.deleteConfirm",
      "sessions.deleteSuccess",
      "sessions.sessionMissing",
      "sessions.actionFailed",
      "sessions.loadFailed",
      "sessions.noTabs",
      "sessions.expand",
      "sessions.collapse",
      "sessions.time.justNow",
      "sessions.time.minutesAgo",
      "sessions.time.hoursAgo",
      "sessions.time.daysAgo",
    ];

    expect(missingKeys("en", sessionKeys)).toEqual([]);
    expect(missingKeys("vi", sessionKeys)).toEqual([]);
  });

  it("covers the extension account card strings in both languages", () => {
    const accountKeys = [
      "settings.account.title",
      "settings.account.description",
      "settings.account.emailLabel",
      "settings.account.emailPlaceholder",
      "settings.account.passwordLabel",
      "settings.account.signIn",
      "settings.account.signingIn",
      "settings.account.createAccount",
      "settings.account.creatingAccount",
      "settings.account.useKeyInstead",
      "settings.account.useAccount",
      "settings.account.keyOnlyHint",
      "settings.account.signOut",
      "settings.account.signedOut",
      "settings.account.signOutFailed",
      "settings.account.verified",
      "settings.account.unverified",
      "settings.account.passwordTooShort",
      "settings.account.signInFailed",
      "settings.account.signUpFailed",
      "settings.account.loadFailed",
      "settings.account.recoveryTitle",
      "settings.account.recoveryMessage",
      "settings.account.recoveryKeyLabel",
      "settings.account.recoveryConfirm",
      "settings.account.recoveryContinue",
      "settings.account.changePassword",
      "settings.account.currentPasswordLabel",
      "settings.account.newPasswordLabel",
      "settings.account.changePasswordSubmit",
      "settings.account.changePasswordSubmitting",
      "settings.account.changePasswordSuccess",
      "settings.account.changePasswordFailed",
      "settings.account.uploadPromptTitle",
      "settings.account.uploadPrompt",
      "settings.account.uploadPromptUpload",
      "settings.account.uploadPromptSkip",
    ];

    expect(missingKeys("en", accountKeys)).toEqual([]);
    expect(missingKeys("vi", accountKeys)).toEqual([]);
  });

  it("covers the setting control strings in both languages", () => {
    const controlKeys = [
      "options.tooltip",
      "options.memoryUnsupported",
      "options.stringList.placeholder",
      "options.stringList.add",
      "options.stringList.remove",
      "options.validation.numberRange",
      "options.validation.maxItems",
      "options.validation.duplicateEntry",
      "options.validation.emptyEntry",
      "settings.memory.discardNow",
      "settings.memory.discardNowSuccess",
      "settings.memory.discardNowFailed",
    ];

    expect(missingKeys("en", controlKeys)).toEqual([]);
    expect(missingKeys("vi", controlKeys)).toEqual([]);
  });
});

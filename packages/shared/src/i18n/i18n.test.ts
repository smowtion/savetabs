import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "../settings-schema";
import { createTranslator, missingKeys, resolveLang } from "./index";

describe("i18n", () => {
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
    expect(resolveLang("auto", "fr-FR")).toBe("en");
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

  it("labels every enum option in both languages", () => {
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
    expect(missingKeys("en", optionKeys)).toEqual([]);
    expect(missingKeys("vi", optionKeys)).toEqual([]);
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
      "settings.sync.loseKeyWarning",
      "settings.sync.onlyCredentialWarning",
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
    ];

    expect(missingKeys("en", controlKeys)).toEqual([]);
    expect(missingKeys("vi", controlKeys)).toEqual([]);
  });
});

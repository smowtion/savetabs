/**
 * Background service worker.
 *
 * Wires browser lifecycle events to the small background behaviors:
 * toolbar action mode, context menus, badge count, keyboard commands,
 * auto-discard and the typed runtime message router.
 *
 * Install and startup also ensure a sync key exists. Sync itself stays
 * disabled until the user turns it on in the options page; while it is on,
 * startup runs an auto-download merge, a save queues its new session for
 * upload, and a five-minute alarm retries pending uploads.
 */

import type { Settings } from "@savetabs/shared";
import { browser } from "wxt/browser";

import {
  applyToolbarAction,
  handleCommand,
  handleToolbarClick,
  updateBadge,
} from "../lib/action";
import {
  handleContextMenuClick,
  rebuildContextMenus,
} from "../lib/context-menus";
import {
  DISCARD_ALARM_NAME,
  applyDiscardAlarm,
  evaluateAndDiscard,
  forgetTabActivity,
  pruneActivity,
  recordActivity,
  recordWindowActivity,
} from "../lib/discard";
import { handleUiMessage } from "../lib/messages";
import { loadSettings, onSettingsChanged } from "../lib/settings";
import { onSessionsChanged } from "../lib/sessions-repo";
import { getOrCreateKey } from "../lib/sync/key-store";
import {
  SYNC_RETRY_ALARM_NAME,
  applySyncAlarm,
  retryPendingSync,
  syncOnStartup,
} from "../lib/sync/sync-lifecycle";

/**
 * Background work is fire-and-forget from event listeners: log failures so a
 * single broken task cannot become an unhandled rejection in the service
 * worker.
 */
function run(task: Promise<unknown>): void {
  void task.catch((error) => {
    console.error("[savetabs] background task failed", error);
  });
}

/** Re-apply every settings-dependent piece of browser state. */
async function applySettings(settings: Settings): Promise<void> {
  await Promise.all([
    applyToolbarAction(settings),
    rebuildContextMenus(settings),
    updateBadge(settings),
    applyDiscardAlarm(settings),
    applySyncAlarm(settings),
  ]);
}

async function applyCurrentSettings(): Promise<void> {
  await applySettings(await loadSettings());
}

/**
 * Install and startup restore settings, drop stale tab activity and make sure
 * a sync key is available. A fresh key never enables sync by itself. Startup
 * additionally runs the auto-download merge, which contains its own failures.
 */
async function initialize(runStartupSync = false): Promise<void> {
  await applyCurrentSettings();
  await pruneActivity();
  await getOrCreateKey();
  if (runStartupSync) await syncOnStartup();
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    run(initialize());
  });
  browser.runtime.onStartup.addListener(() => {
    run(initialize(true));
  });

  // `sendResponse` + `return true` keeps the response channel open on every
  // supported browser, independent of promise-return support in onMessage.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleUiMessage(message).then(sendResponse);
    return true;
  });

  browser.action.onClicked.addListener(() => {
    run(handleToolbarClick());
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    run(handleContextMenuClick(info, tab));
  });

  browser.commands.onCommand.addListener((command) => {
    run(handleCommand(command));
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DISCARD_ALARM_NAME) run(evaluateAndDiscard());
    if (alarm.name === SYNC_RETRY_ALARM_NAME) run(retryPendingSync());
  });

  // Activity tracking feeds the idle threshold. URL changes cover in-page
  // navigations that never report a `complete` status.
  browser.tabs.onActivated.addListener(({ tabId }) => {
    run(recordActivity(tabId));
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url !== undefined) {
      run(recordActivity(tabId));
    }
  });
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    run(recordWindowActivity(windowId));
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    run(forgetTabActivity(tabId));
  });

  onSettingsChanged((settings) => {
    run(applySettings(settings));
  });

  onSessionsChanged(() => {
    run(
      (async () => {
        await updateBadge(await loadSettings());
      })(),
    );
  });
});

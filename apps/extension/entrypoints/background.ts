/**
 * Background service worker.
 *
 * Wires browser lifecycle events to the small background behaviors:
 * toolbar action mode, context menus, badge count, keyboard commands and the
 * typed runtime message router.
 *
 * Sync key generation (Task 18) and the auto-discard alarm (Task 14) are
 * intentionally not wired here.
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
import { handleUiMessage } from "../lib/messages";
import { loadSettings, onSettingsChanged } from "../lib/settings";
import { onSessionsChanged } from "../lib/sessions-repo";

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
  ]);
}

async function applyCurrentSettings(): Promise<void> {
  await applySettings(await loadSettings());
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    run(applyCurrentSettings());
  });
  browser.runtime.onStartup.addListener(() => {
    run(applyCurrentSettings());
  });

  browser.runtime.onMessage.addListener((message) => handleUiMessage(message));

  browser.action.onClicked.addListener(() => {
    run(handleToolbarClick());
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    run(handleContextMenuClick(info, tab));
  });

  browser.commands.onCommand.addListener((command) => {
    run(handleCommand(command));
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

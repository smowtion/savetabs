/**
 * Context menu definitions, synchronization and click routing.
 *
 * Context menus are declarative browser state, not DOM: they must be rebuilt
 * from settings after install, on startup and whenever the `contextMenu.*`
 * settings change. Every rebuild removes the previous items first so disabled
 * entries can never linger.
 */

import {
  createTranslator,
  resolveLang,
  type Settings,
  type Translator,
} from "@savetabs/shared";
import { browser } from "wxt/browser";

import { saveTabs } from "./save-flow";
import { syncSavedSession } from "./sync/sync-lifecycle";
import type { TabLike } from "./tab-collector";

/** Stable ids used to route `contextMenus.onClicked`. */
export const CONTEXT_MENU_IDS = {
  SAVE_TAB: "save-tab",
  SAVE_WINDOW: "save-window",
  SAVE_SELECTION: "save-selection",
} as const;

export type ContextMenuId =
  (typeof CONTEXT_MENU_IDS)[keyof typeof CONTEXT_MENU_IDS];

export type ContextMenuContext = "page" | "tab";

export type ContextMenuDefinition = {
  id: ContextMenuId;
  title: string;
  /** The browser API requires at least one context. */
  contexts: [ContextMenuContext, ...ContextMenuContext[]];
};

/**
 * Dictionary keys for the menu titles. Titles are resolved at rebuild time so
 * a language change in settings re-renders the platform menus.
 */
const CONTEXT_MENU_TITLE_KEYS: Record<ContextMenuId, string> = {
  [CONTEXT_MENU_IDS.SAVE_TAB]: "contextMenu.saveTab",
  [CONTEXT_MENU_IDS.SAVE_WINDOW]: "contextMenu.saveWindow",
  [CONTEXT_MENU_IDS.SAVE_SELECTION]: "contextMenu.saveSelection",
};

/** Browser UI language; falls back to English outside a browser context. */
function getBrowserLanguage(): string {
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en";
}

/** Translator bound to `general.language`; "auto" follows the browser. */
function createMenuTranslator(settings: Settings): Translator {
  const preference = settings["general.language"];
  const language =
    preference === "en" || preference === "vi" ? preference : "auto";
  return createTranslator(resolveLang(language, getBrowserLanguage()));
}

/** Menu entries enabled by the current settings, in stable display order. */
export function getContextMenuDefinitions(
  settings: Settings,
): ContextMenuDefinition[] {
  if (settings["contextMenu.enabled"] !== true) return [];

  const translate = createMenuTranslator(settings);
  const definitions: ContextMenuDefinition[] = [];
  if (settings["contextMenu.saveTab"] === true) {
    definitions.push({
      id: CONTEXT_MENU_IDS.SAVE_TAB,
      title: translate(CONTEXT_MENU_TITLE_KEYS[CONTEXT_MENU_IDS.SAVE_TAB]),
      contexts: ["page", "tab"],
    });
  }
  if (settings["contextMenu.saveWindow"] === true) {
    definitions.push({
      id: CONTEXT_MENU_IDS.SAVE_WINDOW,
      title: translate(CONTEXT_MENU_TITLE_KEYS[CONTEXT_MENU_IDS.SAVE_WINDOW]),
      contexts: ["page", "tab"],
    });
  }
  if (settings["contextMenu.saveSelection"] === true) {
    definitions.push({
      id: CONTEXT_MENU_IDS.SAVE_SELECTION,
      title: translate(
        CONTEXT_MENU_TITLE_KEYS[CONTEXT_MENU_IDS.SAVE_SELECTION],
      ),
      contexts: ["tab"],
    });
  }
  return definitions;
}

/** Replace every extension context menu with the entries current settings allow. */
export async function rebuildContextMenus(settings: Settings): Promise<void> {
  await browser.contextMenus.removeAll();
  for (const definition of getContextMenuDefinitions(settings)) {
    browser.contextMenus.create(definition);
  }
}

/** The parts of `contextMenus.OnClickData` used for routing. */
export type ContextMenuClickInfo = {
  menuItemId: string | number;
  windowId?: number;
  tab?: TabLike;
};

/**
 * Save the scope the user right-clicked.
 *
 * `save-tab` saves the clicked tab, `save-window` the clicked window and
 * `save-selection` every highlighted tab in that window. Menu clicks are
 * explicit user intent, so no confirmation hook is passed; the sync hook is
 * passed so every save entrypoint uploads its freshly created session when
 * sync and auto-upload are enabled.
 */
export async function handleContextMenuClick(
  info: ContextMenuClickInfo,
  tab?: TabLike,
): Promise<void> {
  const clickedTab = info.tab ?? tab;
  const windowId =
    typeof info.windowId === "number" ? info.windowId : clickedTab?.windowId;

  switch (info.menuItemId) {
    case CONTEXT_MENU_IDS.SAVE_TAB:
      if (clickedTab === undefined) {
        await saveTabs("tab", { onSaved: syncSavedSession });
      } else {
        await saveTabs("tab", {
          tabs: [clickedTab],
          windowId,
          onSaved: syncSavedSession,
        });
      }
      return;

    case CONTEXT_MENU_IDS.SAVE_WINDOW:
      if (windowId === undefined) {
        await saveTabs("window", { onSaved: syncSavedSession });
      } else {
        await saveTabs("window", { windowId, onSaved: syncSavedSession });
      }
      return;

    case CONTEXT_MENU_IDS.SAVE_SELECTION: {
      const highlighted = await browser.tabs.query(
        windowId === undefined
          ? { highlighted: true }
          : { highlighted: true, windowId },
      );
      if (highlighted.length === 0) return;
      await saveTabs("selection", {
        tabs: highlighted,
        ...(windowId === undefined ? {} : { windowId }),
        onSaved: syncSavedSession,
      });
      return;
    }

    default:
      return;
  }
}

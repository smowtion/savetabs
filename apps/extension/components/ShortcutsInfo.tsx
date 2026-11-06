/**
 * Incognito status and keyboard shortcut reference for the options page.
 *
 * Both surfaces read real browser state instead of advertising static values:
 * - `isIncognitoAllowed` reports whether the user allowed the extension in
 *   private windows, and the incognito setting is disabled while access is
 *   missing;
 * - `listShortcuts` reads the bindings the browser currently has for this
 *   extension through `commands.getAll()`.
 *
 * The user changes both states outside the options page, so the reads refresh
 * when this page regains visibility or focus (and on `commands.onChanged`
 * where the browser provides it) instead of freezing the mount-time answer.
 *
 * Browsers block opening privileged pages such as `chrome://extensions` from
 * extension code, so the UI shows the path as text with a Copy button instead
 * of rendering a link that could not be opened.
 */

import type { Translator } from "@savetabs/shared";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { copyText } from "../lib/clipboard-write";

/** One command as reported by the browser, with an empty binding omitted. */
export type ShortcutInfo = {
  name: string;
  shortcut?: string;
};

/** Extensions shortcut page for the current browser, shown as copyable text. */
export const SHORTCUTS_PAGE_PATH =
  import.meta.env.BROWSER === "firefox"
    ? "about:addons"
    : "chrome://extensions/shortcuts";

/**
 * i18n labels for the commands declared in the extension manifest. Unknown
 * commands (for example ones added by future versions) fall back to the raw
 * command name so they still render.
 */
const COMMAND_LABEL_KEYS: Readonly<Record<string, string>> = {
  "save-tabs": "settings.shortcuts.commandLabel.save-tabs",
  "open-sessions": "settings.shortcuts.commandLabel.open-sessions",
  "discard-now": "settings.shortcuts.commandLabel.discard-now",
};

const BUTTON_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800";

type CopyStatus = "success" | "error";

type CommandsChangedEvent = {
  addListener(listener: () => void): void;
  removeListener(listener: () => void): void;
};

/**
 * `commands.onChanged` exists in Chrome MV3 but not in every browser, so it is
 * feature-detected instead of assumed.
 */
function readCommandsChangedEvent(): CommandsChangedEvent | undefined {
  const event = (browser as unknown as { commands?: { onChanged?: unknown } })
    .commands?.onChanged;
  if (event === null || typeof event !== "object") return undefined;
  const candidate = event as Partial<CommandsChangedEvent>;
  return typeof candidate.addListener === "function" &&
    typeof candidate.removeListener === "function"
    ? (candidate as CommandsChangedEvent)
    : undefined;
}

/**
 * Read the shortcuts the browser currently has bound.
 *
 * `commands.getAll()` returns every declared command, using an empty string
 * when the user has not assigned a shortcut. Empty and malformed entries are
 * normalized away; a failed call yields an empty list so the page still
 * renders the instructions.
 */
export async function listShortcuts(): Promise<ShortcutInfo[]> {
  const commandsApi = (
    browser as unknown as {
      commands?: { getAll?: () => Promise<unknown> };
    }
  ).commands;
  if (typeof commandsApi?.getAll !== "function") return [];

  let raw: unknown;
  try {
    raw = await commandsApi.getAll.call(commandsApi);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const shortcuts: ShortcutInfo[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { name, shortcut } = entry as { name?: unknown; shortcut?: unknown };
    if (typeof name !== "string" || name.length === 0) continue;
    if (typeof shortcut === "string" && shortcut.length > 0) {
      shortcuts.push({ name, shortcut });
    } else {
      shortcuts.push({ name });
    }
  }
  return shortcuts;
}

function commandLabel(t: Translator, name: string): string {
  const labelKey = COMMAND_LABEL_KEYS[name];
  return labelKey === undefined ? name : t(labelKey);
}

export type ShortcutsInfoProps = {
  t: Translator;
};

export function ShortcutsInfo({ t }: ShortcutsInfoProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[] | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  useEffect(() => {
    let active = true;

    function refresh(): void {
      void listShortcuts().then((entries) => {
        if (active) setShortcuts(entries);
      });
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") refresh();
    }

    refresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refresh);
    // The user edits bindings on another browser page; refresh when the
    // browser reports the change while this panel stays mounted.
    const onChanged = readCommandsChangedEvent();
    onChanged?.addListener(refresh);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refresh);
      onChanged?.removeListener(refresh);
    };
  }, []);

  async function copyPath(): Promise<void> {
    try {
      await copyText(SHORTCUTS_PAGE_PATH);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {shortcuts === null ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t("common.loading")}
        </p>
      ) : shortcuts.length > 0 ? (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {t("settings.shortcuts.tableCaption")}
          </caption>
          <thead>
            <tr className="text-start text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              <th scope="col" className="py-1 pe-4 font-medium">
                {t("settings.shortcuts.commandHeader")}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t("settings.shortcuts.bindingHeader")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shortcuts.map(({ name, shortcut }) => (
              <tr
                key={name}
                className="border-t border-neutral-100 dark:border-neutral-800"
              >
                <th
                  scope="row"
                  className="py-2 pe-4 text-start font-normal text-neutral-900 dark:text-neutral-100"
                >
                  {commandLabel(t, name)}
                </th>
                <td className="py-2 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                  {shortcut === undefined ? (
                    <span className="font-sans text-neutral-500 dark:text-neutral-400">
                      {t("settings.shortcuts.notSet")}
                    </span>
                  ) : (
                    shortcut
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("settings.shortcuts.instructions")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code
            aria-label={t("settings.shortcuts.pagePathLabel")}
            className="min-w-0 break-all rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800"
          >
            {SHORTCUTS_PAGE_PATH}
          </code>
          <button
            type="button"
            onClick={() => void copyPath()}
            className={BUTTON_CLASS}
          >
            {t("settings.shortcuts.copyPath")}
          </button>
        </div>
        {copyStatus !== null && (
          <p
            role={copyStatus === "success" ? "status" : "alert"}
            className={`mt-1 text-xs ${
              copyStatus === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {copyStatus === "success"
              ? t("settings.shortcuts.copySuccess")
              : t("settings.shortcuts.copyFailed")}
          </p>
        )}
      </div>
    </div>
  );
}

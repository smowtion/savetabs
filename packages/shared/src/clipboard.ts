import type { SavedTab } from "./types";

/** Clipboard output format used by the copy action. */
export type ClipboardFormat = "plain-urls" | "markdown" | "titled";

/**
 * Renders tabs for the clipboard.
 *
 * - `plain-urls`: one URL per line.
 * - `markdown`: one `- [title](url)` list item per line.
 * - `titled`: `title\nurl` per tab, with a blank line between tabs.
 *
 * An empty tab list yields an empty string.
 */
export function formatTabsForClipboard(
  tabs: readonly SavedTab[],
  format: ClipboardFormat,
): string {
  switch (format) {
    case "plain-urls":
      return tabs.map((tab) => tab.url).join("\n");
    case "markdown":
      return tabs.map((tab) => `- [${tab.title}](${tab.url})`).join("\n");
    case "titled":
      return tabs.map((tab) => `${tab.title}\n${tab.url}`).join("\n\n");
  }
}

/**
 * Copy text to the clipboard from an extension page.
 *
 * The asynchronous Clipboard API is preferred because it works without an
 * extension permission. When it is unavailable or denied (for example in an
 * insecure context) a temporary off-screen textarea is selected and copied
 * through `document.execCommand("copy")`, which every supported browser still
 * implements for synthetic copies.
 *
 * The returned promise rejects when both paths fail, so callers can render a
 * visible error instead of pretending the copy succeeded.
 */

/** Copy `text`, rejecting when neither clipboard path works. */
export async function copyText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard !== undefined && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    const copied =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
    if (!copied) throw new Error("clipboard copy failed");
  } finally {
    textarea.remove();
  }
}

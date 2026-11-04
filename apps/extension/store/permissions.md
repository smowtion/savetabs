# SaveTabs — permission justifications

Store review notes for every permission requested in the manifest. SaveTabs
declares four API permissions plus one host permission. It has **no content
scripts**, no `activeTab`, no `scripting`, no `cookies`, no `history`, no
`bookmarks`, and no `<all_urls>` host access.

## `tabs`

Reads tab metadata so saving and restoring can work: URL, title, pinned state,
audible state, window id, and tab index. The same permission lets the extension
close saved tabs, discard idle tabs, restore sessions into the current or a new
window, and keep the toolbar badge count accurate. Tab data is stored locally
or, when sync is enabled, only inside end-to-end encrypted blobs.

This permission is the reason the browser shows a browsing-history warning. The
extension does not read page content and does not send tab URLs or titles to any
server in readable form.

## `storage`

Stores extension settings, UI preferences, discard activity bookkeeping, the
locally generated sync key, and small sync status flags in `extension.storage.local`.
Saved sessions live in the extension's own IndexedDB database, which is scoped
to the extension origin and needs no additional permission. Nothing in local
storage is uploaded unless the user enables sync, and then only encrypted
session blobs are uploaded.

## `alarms`

Schedules two background jobs without keeping a timer alive:
- a one-minute sweep that evaluates inactive tabs for auto-discard (only acts
  where `tabs.discard` exists), and
- a 24-hour version check that compares the installed version with the release
  feed so the UI can show an update notice.

## `contextMenus`

Adds right-click menu entries for Save tabs, Open sessions, and Discard inactive
tabs now. The menu items call the same internal actions as the toolbar and
keyboard shortcuts.

## Host permission: the sync API origin only

`host_permissions` contains exactly one origin, the configured sync API base
(`https://api.savetabs.example/*` in development; set at build time through
`WXT_SAVETABS_API_BASE`). It is used only for optional end-to-end encrypted sync
requests. When sync is off, the extension makes no requests to that origin.
There is no broad host access and no access to browsing content.

## Not requested

- No `activeTab` or `scripting`: SaveTabs never injects scripts into pages.
- No content scripts of any kind.
- No `file://` access in the manifest. Saving local file URLs is off by default
  and additionally requires the user to grant "Allow access to file URLs" in
  the browser's extension settings.
- No third-party network origins, analytics, or advertising SDKs.

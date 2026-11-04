/** A single tab captured inside a session. */
export type SavedTab = {
  /** http/https URL; file:// only when tabs.includeFileUrls is enabled. */
  url: string;
  title: string;
  /** May be a data: URI returned by the browser. */
  favIconUrl?: string;
  pinned?: boolean;
};

/** How a session was captured. */
export type SessionSource = "window" | "all-windows" | "tab" | "selection";

/** A saved set of tabs, stored locally and synced encrypted when allowed. */
export type Session = {
  /** crypto.randomUUID() */
  id: string;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
  /** User rename; the UI renders a timestamp when absent. */
  title?: string;
  source: SessionSource;
  tabs: SavedTab[];
  /** Local-only flag: session has not been uploaded yet. */
  pendingUpload?: boolean;
  /** Local-only: incognito sessions are never uploaded or synced. */
  incognito?: boolean;
  /**
   * Local-only: the user chose "skip upload" when importing a sync key.
   * Existing sessions keep this flag so the sync service never uploads them;
   * sessions created afterwards are not flagged and sync normally.
   */
  syncExcluded?: boolean;
};

/** Settings values persisted in chrome.storage.local, keyed by setting key. */
export type Settings = Record<string, boolean | number | string | string[]>;

/** Response body of GET /v1/version. */
export type VersionInfo = {
  extension: {
    chrome: string;
    firefox: string;
  };
  notesUrl: string;
  /** epoch ms */
  updatedAt: number;
};

/** Session metadata returned by the sync API list endpoints. */
export type SessionSummary = {
  id: string;
  /** epoch ms */
  updatedAt: number;
  /** Encrypted blob size in bytes. */
  size: number;
};

/** Error codes used in the sync API's `{ error: { code, message } }` body. */
export type ApiErrorCode =
  | "unauthorized"
  | "not_found"
  | "quota_exceeded"
  | "payload_too_large"
  | "invalid_request"
  | "rate_limited"
  | "capacity_exceeded";

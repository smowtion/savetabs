# SaveTabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SaveTabs v1: browser extension (Chromium + Firefox) lưu/đóng tab thành session, auto-discard giảm RAM, options UI compact, sync E2EE qua Cloudflare Worker + D1, web app xem/restore bằng key — deploy live và submit Chrome Web Store + Firefox AMO.

**Architecture:** pnpm monorepo gồm `apps/extension` (WXT + React), `apps/worker` (Hono + D1 + R2), `apps/web` (Vite + React) và `packages/shared` (types, settings schema, crypto, i18n, sync client). Server chỉ giữ authId + hash(authKey) + blob AES-GCM + tombstone; key không rời client. Sessions lưu local trong IndexedDB; settings trong `storage.local`.

**Tech Stack:** TypeScript strict, pnpm 9, WXT, React 18, Tailwind CSS, Zustand, Lucide, Vitest, React Testing Library, `wxt/testing` + `@webext-core/fake-browser`, `fake-indexeddb`, `@cloudflare/vitest-pool-workers`, Wrangler, Hono, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-savetabs-design.md`

## Global Constraints

- Node >= 22.12, pnpm >= 9; TypeScript `strict: true` toàn repo.
- Plan giả định **SaveTabs là git repo riêng** (`git init` trong thư mục này) để CI/release tách khỏi workspace repo hiện tại; nếu chủ dự án muốn giữ trong workspace repo, đổi path trong workflow tương ứng.
- Không content script; `host_permissions` chỉ chứa domain API lấy từ `SAVETABS_API_BASE`.
- Mọi chuỗi UI đi qua i18n en/vi; không hardcode text trong component.
- Đúng 36 setting trong schema; mọi key phải được ít nhất một module tiêu thụ (coverage test fail nếu không).
- Không có setting/button giả; action nào cũng phải có hành vi thật.
- Giới hạn: 256 KiB/session blob, 500 tab/session, 200 session/key, 5 MiB/key, 500 session local / 15.000 tab local.
- E2EE: URL/title không bao giờ gửi plaintext; server chỉ nhận authId, hash(authKey), ciphertext, tombstone, timestamp, size.
- **Incognito: session chỉ lưu local, không bao giờ upload/sync**; setting mặc định tắt.
- Chỉ lưu/restore `http(s)`; `file://` chỉ khi `tabs.includeFileUrls`; bỏ `chrome://`, `edge://`, `about:`, `chrome-extension://`, `devtools://`.
- Chrome MV3 + Firefox MV3 từ cùng codebase WXT; feature-detect các API Firefox có thể thiếu.
- API base và web origin lấy từ env; không hardcode domain.
- **Prerequisites cho Phase 4:** Cloudflare account (Worker/D1/R2/Pages), domain thật, GitHub remote, Chrome Web Store + AMO credentials. Task 32 và 34 BLOCK nếu thiếu; không tự tạo tài khoản.
- Mỗi task kết thúc bằng commit conventional, không tham chiếu AI.

## Review Focus

Năm failure mode dễ gây hậu quả nhất, mỗi dòng có test ở task tương ứng:

1. Tab `chrome://`/`file://` bị lưu rồi restore thất bại → collector phải lọc theo scheme (Task 11).
2. Key không có dữ liệu (kể cả gõ sai) phải hiện trạng thái "no data for this key" kèm gợi ý kiểm tra key, không hiển thị empty-success chung chung (Task 28, Task 29).
3. Session đã xoá bị sync kéo về lại → tombstone server + local chặn resurrection (Task 7, Task 23, Task 25).
4. Session incognito bị upload → sync service phải loại `incognito: true` trước khi mã hoá/gửi (Task 25).
5. Firefox thiếu `tabs.discard`/`storage.session` phải ẩn tính năng, không hiện control chết (Task 14).

---

## File Structure (khóa trước khi chia task)

```
SaveTabs/
├── package.json                     # root scripts, devDeps dùng chung
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore                       # + .superpowers/
├── packages/shared/
│   ├── package.json                 # name: @savetabs/shared
│   ├── src/
│   │   ├── index.ts                 # re-export public API
│   │   ├── types.ts                 # SavedTab, Session, SessionSummary, ...
│   │   ├── constants.ts
│   │   ├── base64url.ts
│   │   ├── crypto/key.ts
│   │   ├── crypto/session-cipher.ts
│   │   ├── settings-schema.ts
│   │   ├── duplicates.ts
│   │   ├── clipboard.ts
│   │   ├── merge.ts
│   │   ├── discard-policy.ts
│   │   ├── i18n/index.ts, en.json, vi.json
│   │   └── api/sync-client.ts
│   └── tsconfig.json
├── apps/extension/
│   ├── wxt.config.ts, package.json, vitest.config.ts
│   ├── entrypoints/
│   │   ├── background.ts
│   │   ├── options/index.html, main.tsx, App.tsx
│   │   ├── popup/index.html, main.tsx, App.tsx
│   │   └── sessions/index.html, main.tsx, App.tsx
│   ├── components/                  # SettingsSidebar, Accordion, SearchBar, SettingRow,
│   │                                # Toggle, Select, NumberInput, StringListInput, Tooltip,
│   │                                # SessionCard, ConfirmDialog, SyncSection, SyncStatus,
│   │                                # AdvancedActions, ShortcutsInfo
│   ├── hooks/useSettings.ts, useI18n.ts
│   ├── lib/
│   │   ├── settings.ts              # storage.local
│   │   ├── sessions-db.ts           # IndexedDB mở/upgrade
│   │   ├── sessions-repo.ts         # CRUD + tombstones + caps + BroadcastChannel
│   │   ├── tab-collector.ts         # pure
│   │   ├── save-flow.ts
│   │   ├── restore.ts
│   │   ├── discard.ts
│   │   ├── messages.ts
│   │   ├── context-menus.ts
│   │   ├── action.ts
│   │   ├── incognito.ts
│   │   ├── settings-export.ts
│   │   ├── sync/key-store.ts
│   │   ├── sync/sync-service.ts
│   │   └── version-check.ts
│   └── assets/icon/                 # 16/32/48/128 png
├── apps/worker/
│   ├── wrangler.toml
│   ├── migrations/0001_init.sql
│   ├── src/index.ts, env.ts, auth.ts, cors.ts, quota.ts, counters.ts
│   ├── src/routes/sessions.ts, routes/version.ts
│   └── test/*.test.ts
├── apps/web/
│   ├── vite.config.ts, index.html, public/_headers
│   ├── src/main.tsx, App.tsx
│   ├── src/pages/Landing.tsx, pages/Sessions.tsx, pages/Privacy.tsx
│   ├── src/components/SessionCard.tsx
│   └── src/lib/key-session.ts
├── e2e/web.spec.ts
├── playwright.config.ts
├── scripts/generate-icons.mjs, scripts/update-versions.mjs, scripts/verify-build.mjs
└── .github/workflows/ci.yml, release.yml
```

---

## Phase 0 — Foundation (`packages/shared`)

### Task 1: Monorepo scaffold + shared package skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `packages/shared/src/constants.ts`
- Test: `packages/shared/src/constants.test.ts`

**Interfaces:**
- Produces: `LIMITS`, `APP_NAME`, types `SavedTab`, `Session` (gồm `incognito?: boolean`), `SessionSource`, `Settings`, `VersionInfo`, `SessionSummary`, `ApiErrorCode`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/constants.test.ts
import { describe, it, expect } from "vitest";
import { LIMITS, APP_NAME } from "./constants";

describe("constants", () => {
  it("pins sync limits", () => {
    expect(LIMITS.maxSessionBytes).toBe(262144);
    expect(LIMITS.maxTabsPerSession).toBe(500);
    expect(LIMITS.maxSessionsPerKey).toBe(200);
    expect(LIMITS.maxKeyBytes).toBe(5 * 1024 * 1024);
    expect(LIMITS.maxLocalSessions).toBe(500);
    expect(LIMITS.maxLocalTabs).toBe(15000);
    expect(APP_NAME).toBe("SaveTabs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/constants.test.ts`
Expected: FAIL — module `./constants` not found.

- [ ] **Step 3: Create root + shared package configs and `constants.ts`**

Root `package.json`: private, `packageManager: "pnpm@9"`, scripts `test`, `typecheck`, `build`; devDeps `typescript`, `vitest`. `pnpm-workspace.yaml`: `["apps/*", "packages/*"]`. `tsconfig.base.json`: ES2022, strict, `moduleResolution: "Bundler"`, `skipLibCheck: true`. `.gitignore`: `node_modules/`, `dist/`, `.output/`, `.wrangler/`, `.superpowers/`, `.env*` (trừ `.env.example`).

`types.ts` theo spec §5.1: `Session.incognito?: boolean`; `Settings` là record key→value; `SessionSummary = { id; updatedAt; size }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm vitest run packages/shared/src/constants.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git init   # nếu chưa phải repo riêng
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .editorconfig packages/shared
git commit -m "chore: scaffold pnpm workspace and shared package"
```

### Task 2: Key generation, parsing, derivation, hashing

**Files:**
- Create: `packages/shared/src/base64url.ts`, `packages/shared/src/crypto/key.ts`
- Test: `packages/shared/src/crypto/key.test.ts`

**Interfaces:**
- Produces:
  - `generateKey(): string` — `ST-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`
  - `parseKey(input: string): Uint8Array` — throws `InvalidKeyError`
  - `formatKey(raw: Uint8Array): string`
  - `deriveKeys(rawKey: Uint8Array): Promise<{ authId: string; authKey: string; encKey: CryptoKey }>`
  - `hashAuthKey(authKey: string): Promise<string>` — SHA-256 hex
  - `toBase64Url(bytes: Uint8Array): string`, `fromBase64Url(s: string): Uint8Array`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generateKey, parseKey, formatKey, deriveKeys, hashAuthKey } from "./key";

it("generates a parsable 128-bit key", () => {
  const key = generateKey();
  expect(key).toMatch(/^ST(-[0-9A-HJKMNP-TV-Z]{5}){5}-[0-9A-HJKMNP-TV-Z]$/);
  expect(parseKey(key)).toHaveLength(16);
});
it("round-trips and forgives case/dashes", () => {
  const raw = parseKey("st-abcde-fghjk-mnpqr-stvwx-yz012-34567");
  expect(parseKey(formatKey(raw))).toEqual(raw);
});
it("derives deterministic independent values", async () => {
  const raw = parseKey(generateKey());
  const a = await deriveKeys(raw), b = await deriveKeys(raw);
  expect(a.authId).toBe(b.authId);
  expect(a.authKey).toBe(b.authKey);
  expect(a.authId).toHaveLength(22);
  expect(await hashAuthKey(a.authKey)).toMatch(/^[0-9a-f]{64}$/);
});
it("rejects malformed keys", () => {
  expect(() => parseKey("ST-123")).toThrow("InvalidKeyError");
});
```

- [ ] **Step 2: Run** → FAIL.

Run: `pnpm vitest run packages/shared/src/crypto/key.test.ts`

- [ ] **Step 3: Implement**

Crockford Base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; decode map I/L→1, O→0; 26 ký tự = 128 bit. HKDF-SHA256 salt `savetabs-v1`, info `auth-id` (128b) / `auth-key` (256b) / `enc-key` (AES-GCM 256). `hashAuthKey` dùng WebCrypto digest.

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add key generation and derivation`

### Task 3: Session encryption (AES-GCM + AAD)

**Files:**
- Create: `packages/shared/src/crypto/session-cipher.ts`
- Test: `packages/shared/src/crypto/session-cipher.test.ts`

**Interfaces:**
- Produces:
  - `encryptSession(encKey: CryptoKey, authId: string, session: Session): Promise<string>` — base64url(IV || ciphertext)
  - `decryptSession(encKey: CryptoKey, authId: string, sessionId: string, blob: string): Promise<Session>`

- [ ] **Step 1: Write the failing test**

```ts
const session = {
  id: "11111111-1111-4111-8111-111111111111", createdAt: 1, updatedAt: 2,
  source: "window" as const, tabs: [{ url: "https://example.com/a", title: "A" }],
};
it("round-trips", async () => {
  const { encKey, authId } = await deriveKeys(parseKey(generateKey()));
  const blob = await encryptSession(encKey, authId, session);
  await expect(decryptSession(encKey, authId, session.id, blob)).resolves.toEqual(session);
});
it("fails on wrong AAD and tampering", async () => {
  const { encKey, authId } = await deriveKeys(parseKey(generateKey()));
  const blob = await encryptSession(encKey, authId, session);
  await expect(decryptSession(encKey, "other", session.id, blob)).rejects.toThrow();
  const bytes = Buffer.from(blob, "base64url");
  bytes[bytes.length - 1] ^= 1;
  await expect(decryptSession(encKey, authId, session.id, bytes.toString("base64url"))).rejects.toThrow();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** IV 12 byte; AAD `savetabs:v1:<authId>:<sessionId>`; JSON serialize; base64url(IV||ct); decrypt validate length.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add E2EE session cipher`

### Task 4: Settings schema, defaults, validation

**Files:**
- Create: `packages/shared/src/settings-schema.ts`
- Test: `packages/shared/src/settings-schema.test.ts`

**Interfaces:**
- Produces: `CategoryId` (14 giá trị), `SETTINGS_SCHEMA`, `DEFAULT_SETTINGS`, `SETTING_KEYS`, `getSettingDef`, `validateSettings`.

- [ ] **Step 1: Write the failing test**

```ts
it("has 14 categories and 36 unique settings", () => {
  expect(SETTINGS_SCHEMA).toHaveLength(14);
  expect(SETTING_KEYS).toHaveLength(36);
  expect(new Set(SETTING_KEYS).size).toBe(36);
  expect(DEFAULT_SETTINGS["memory.timeoutMinutes"]).toBe(30);
  expect(DEFAULT_SETTINGS["sync.enabled"]).toBe(false);
  expect(DEFAULT_SETTINGS["open.toolbarAction"]).toBe("popup");
});
it("rejects invalid values with field errors", () => {
  const bad = validateSettings({ "memory.timeoutMinutes": 7, "general.theme": "blue" });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.errors).toHaveLength(2);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** đủ 36 setting theo spec §5.2 (labelKey/descriptionKey/keywords); validate enum/number/string-list; bỏ key lạ.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add typed settings schema`

### Task 5: i18n core and dictionaries

**Files:**
- Create: `packages/shared/src/i18n/index.ts`, `en.json`, `vi.json`
- Test: `packages/shared/src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `Lang`, `resolveLang(pref, navigatorLang)`, `createTranslator(lang)`, `missingKeys(lang, keys)`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** dictionaries đủ key category/setting/common/popup/sessions/sync/errors; interpolation `{var}`; fallback trả key.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add en/vi dictionaries`

### Task 6: Duplicate matcher + clipboard formatter

**Files:**
- Create: `packages/shared/src/duplicates.ts`, `packages/shared/src/clipboard.ts`
- Test: `duplicates.test.ts`, `clipboard.test.ts`

**Interfaces:**
- Produces: `MatchMode`, `normalizeUrl`, `dedupeTabs`, `isUrlAlreadySaved`, `ClipboardFormat`, `formatTabsForClipboard`.

- [ ] **Step 1: Write the failing tests**

```ts
it("normalizes per mode", () => {
  expect(normalizeUrl("https://a.com/p?q=1#x", "exact")).toBe("https://a.com/p?q=1#x");
  expect(normalizeUrl("https://a.com/p?q=1#x", "ignore-hash")).toBe("https://a.com/p?q=1");
  expect(normalizeUrl("https://a.com/p?q=1#x", "ignore-query")).toBe("https://a.com/p#x");
});
it("formats all clipboard modes", () => {
  const tabs = [{ url: "https://a.com", title: "A" }];
  expect(formatTabsForClipboard(tabs, "plain-urls")).toBe("https://a.com");
  expect(formatTabsForClipboard(tabs, "markdown")).toBe("- [A](https://a.com)");
  expect(formatTabsForClipboard(tabs, "titled")).toBe("A\nhttps://a.com");
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** dùng `new URL`; dedupe giữ first; input rỗng → chuỗi rỗng.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add duplicate and clipboard helpers`

### Task 7: Session merge, tombstones, discard policy

**Files:**
- Create: `packages/shared/src/merge.ts`, `packages/shared/src/discard-policy.ts`
- Test: `merge.test.ts`, `discard-policy.test.ts`

**Interfaces:**
- Produces: `Tombstone`, `mergeSessions(local, remote, tombstones, now)`, `pruneTombstones`, `DiscardCandidate`, `isDiscardEligible(tab, opts)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("newer wins, remote-only added, tombstones block resurrection", () => {
  const local = [{ id: "a", updatedAt: 2, createdAt: 1, source: "window", tabs: [] }];
  const remote = [
    { id: "a", updatedAt: 1, createdAt: 1, source: "window", tabs: [] },
    { id: "b", updatedAt: 3, createdAt: 3, source: "window", tabs: [] },
    { id: "c", updatedAt: 4, createdAt: 4, source: "window", tabs: [] },
  ];
  const merged = mergeSessions(local, remote, [{ id: "c", deletedAt: 10 }], 20);
  expect(merged.map(s => s.id)).toEqual(["a", "b"]);
});
it("remote tombstone removes local session older than it", () => {
  const local = [{ id: "x", updatedAt: 5, createdAt: 5, source: "window", tabs: [] }];
  expect(mergeSessions(local, [], [{ id: "x", deletedAt: 6 }], 20)).toEqual([]);
});
it("discard eligibility keeps active/pinned/audible/discarded/excluded", () => {
  const base = { id: 1, active: false, pinned: false, audible: false, discarded: false, url: "https://a.com", lastActiveAt: 0 };
  const opts = { now: 31 * 60_000, timeoutMinutes: 30, keepPinned: true, keepAudible: true, excludedDomains: [] };
  expect(isDiscardEligible(base, opts)).toBe(true);
  expect(isDiscardEligible({ ...base, pinned: true }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, audible: true }, opts)).toBe(false);
  expect(isDiscardEligible({ ...base, url: "https://mail.google.com/x" }, { ...opts, excludedDomains: ["mail.google.com"] })).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** LWW; tombstone thắng; prune 30 ngày; domain match exact hoặc subdomain.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(shared): add merge, tombstones, discard policy`

---

## Phase 1 — Extension

### Task 8: WXT scaffold + manifest

**Files:**
- Create: `apps/extension/package.json`, `tsconfig.json`, `wxt.config.ts`, `entrypoints/background.ts`
- Modify: root `package.json`
- Verify: `pnpm build:ext`

**Interfaces:**
- Produces manifest với permissions `["tabs","storage","alarms","contextMenus"]`, commands `save-tabs`/`open-sessions`/`discard-now`, `host_permissions` từ `SAVETABS_API_BASE`, gecko id.

- [ ] **Step 1: Add build script + expected manifest assertions**
- [ ] **Step 2: Run** `pnpm build:ext` → FAIL (chưa có app).
- [ ] **Step 3: Create WXT app** với `@wxt-dev/module-react`, React 18, Tailwind, Zustand, Lucide; manifest như spec §7.1/§9.5.
- [ ] **Step 4: Run** `pnpm build:ext`; assert `.output/chrome-mv3/manifest.json` có `tabs` trong permissions và 3 commands.
- [ ] **Step 5: Commit** `feat(extension): scaffold WXT app and manifest`

### Task 9: Settings store (`storage.local`)

**Files:**
- Create: `apps/extension/lib/settings.ts`, `apps/extension/vitest.config.ts`
- Test: `apps/extension/lib/settings.test.ts`

**Interfaces:**
- Produces: `loadSettings()`, `saveSetting(key, value)`, `resetSettings()`, `onSettingsChanged(cb)`; storage key `settings`, version 1.

- [ ] **Step 1: Write failing test** — defaults khi rỗng; persist/reset; merge defaults; invalid stored value bị loại.
- [ ] **Step 2: Run** `pnpm --filter @savetabs/extension test` → FAIL.
- [ ] **Step 3: Implement** merge + validate; debounce 200ms; `storage.onChanged`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add settings store`

### Task 10: Sessions repository (IndexedDB)

**Files:**
- Create: `apps/extension/lib/sessions-db.ts`, `apps/extension/lib/sessions-repo.ts`
- Test: `apps/extension/lib/sessions-repo.test.ts`
- Modify: `apps/extension/vitest.config.ts` (setup `fake-indexeddb/auto`)

**Interfaces:**
- Produces:
  - `listSessions(): Promise<Session[]>` (mới nhất trước)
  - `getSession(id)`, `addSession(session)`, `updateSession(id, patch)`
  - `deleteSession(id, now?)` — xoá IDB + ghi tombstone + broadcast
  - `getTombstones(): Promise<Tombstone[]>`
  - `broadcastSessionsChanged(): void` — `BroadcastChannel("savetabs-events")`
- DB: `savetabs`, version 1, store `sessions` keyPath `id`, index `updatedAt`; store `tombstones` keyPath `id`.

- [ ] **Step 1: Write failing tests** — add newest-first; delete writes tombstone; caps: seed `maxLocalSessions`, expect `QuotaError` khi add tiếp; broadcast event phát ra.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** IDB helpers + caps (90% warn state, 100% throw); tombstone prune 30 ngày khi mở DB.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add IndexedDB sessions repository`

### Task 11: Tab collector + save flow

**Files:**
- Create: `apps/extension/lib/tab-collector.ts`, `apps/extension/lib/save-flow.ts`
- Test: `tab-collector.test.ts`, `save-flow.test.ts`

**Interfaces:**
- Produces:
  - `TabLike`
  - `collectTabsForSave(tabs, { settings, existingSessions }): { tabs: SavedTab[]; skipped: number }`
  - `saveTabs(source, opts?: { tabs?; windowId?; confirm? }): Promise<{ session?: Session; skipped: number; closed: number; overflow: number }>`
- Save session có `incognito: true` nếu nguồn là cửa sổ incognito.

- [ ] **Step 1: Write failing tests**

```ts
it("filters non-restorable schemes and pinned", () => {
  const settings = { ...DEFAULT_SETTINGS, "pinned.skipOnSave": true };
  const tabs = [
    { url: "https://a.com", title: "A" },
    { url: "chrome://settings" },
    { url: "https://b.com", title: "B", pinned: true },
    { url: "file:///tmp/x" },
  ];
  const res = collectTabsForSave(tabs, { settings, existingSessions: [] });
  expect(res.tabs.map(t => t.url)).toEqual(["https://a.com"]);
  expect(res.skipped).toBe(3);
});
it("caps at 500 tabs and leaves the rest open", async () => {
  const res = await saveTabs("window", { tabs: makeTabs(501) });
  expect(res.session?.tabs).toHaveLength(500);
  expect(res.overflow).toBe(1);
  expect(res.closed).toBe(500);
});
it("marks incognito sessions", async () => { /* window.incognito=true → session.incognito === true */ });
it("returns no session when nothing to save", async () => { /* chrome://newtab only */ });
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** collector thuần; save flow: query, filter, confirm threshold (chỉ khi có UI), `addSession`, close (bỏ qua tab sessions page), mở sessions page, enqueue sync (trừ incognito).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add tab collection and save flow`

### Task 12: Restore flow

**Files:**
- Create: `apps/extension/lib/restore.ts`
- Test: `apps/extension/lib/restore.test.ts`

**Interfaces:**
- Produces: `planRestore(session, settings, openUrls): { tabs: SavedTab[] }`, `executeRestore(session): Promise<{ opened: number }>`.

- [ ] **Step 1: Write failing tests** — skipExisting; targetWindow=new; pinned restore; non-http(s) bị bỏ.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** current/new window; `active: !openInBackground`; `pinned: true` khi cấu hình.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add session restore`

### Task 13: Background wiring (messages, action, menus, badge)

**Files:**
- Create: `lib/messages.ts`, `lib/action.ts`, `lib/context-menus.ts`
- Modify: `entrypoints/background.ts`
- Test: `action.test.ts`, `context-menus.test.ts`

**Interfaces:**
- Produces: `UiMessage` union (SAVE_TABS, RESTORE_SESSION, DELETE_SESSION, SYNC_NOW, DISCARD_NOW), `applyToolbarAction`, `updateBadge`, `rebuildContextMenus`, `handleToolbarClick`.

- [ ] **Step 1: Write failing tests** — toolbarAction=save → popup `""`; badge theo `showBadgeCount`; 3 menu items theo setting.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `onInstalled` (generate key, defaults, menus, alarms), message router, click routing, `storage.onChanged` re-apply, commands listeners.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): wire background and menus`

### Task 14: Auto-discard service

**Files:**
- Create: `apps/extension/lib/discard.ts`
- Modify: `entrypoints/background.ts`
- Test: `discard.test.ts`

**Interfaces:**
- Produces: `isDiscardSupported()`, `recordActivity(tabId, now?)`, `evaluateAndDiscard(now?)`, `discardNow()`.

- [ ] **Step 1: Write failing tests** — `tabs.discard` undefined → supported=false, no-op; chỉ discard eligible; dùng `storage.session` khi có, fallback `storage.local`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** alarm 1 phút; activity map; bỏ qua tab extension; Firefox thiếu API → ẩn UI.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add auto-discard service`

### Task 15: Options shell (sidebar, accordion, search, theme)

**Files:**
- Create: `entrypoints/options/index.html`, `main.tsx`, `App.tsx`
- Create: `components/SettingsSidebar.tsx`, `Accordion.tsx`, `SearchBar.tsx`
- Create: `hooks/useSettings.ts`, `hooks/useI18n.ts`
- Test: `SettingsSidebar.test.tsx`, `Accordion.test.tsx`

**Interfaces:**
- Consumes: `SETTINGS_SCHEMA`, settings store, `createTranslator`.
- Produces: layout A; search; expand/collapse; theme.

- [ ] **Step 1: Write failing tests** — 14 category + count đúng; search "discard" trả về memory settings; expand all mở tất cả.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** sidebar 220px, responsive <900px dropdown; Cmd/Ctrl+K; `ui.openSections` trong storage.local; theme data-attribute.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add compact options shell`

### Task 16: Setting controls + render all 36 settings

**Files:**
- Create: `components/Toggle.tsx`, `Select.tsx`, `NumberInput.tsx`, `StringListInput.tsx`, `Tooltip.tsx`, `SettingRow.tsx`, `CategorySection.tsx`
- Test: `SettingRow.test.tsx`, `CategorySection.test.tsx`

**Interfaces:**
- Produces: `SettingRow` dispatch theo type; mọi thay đổi gọi `saveSetting`; mỗi key render đúng một lần.

- [ ] **Step 1: Write failing tests** — toggle writes; number min/max; render every key once.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** accessible controls; tooltip; disabled state khi feature không hỗ trợ.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): render typed setting controls`

### Task 17: Import/export settings + bulk sessions, reset

**Files:**
- Create: `lib/settings-export.ts`, `lib/sessions-export.ts`, `components/ConfirmDialog.tsx`, `components/AdvancedActions.tsx`
- Test: `settings-export.test.ts`, `sessions-export.test.ts`

**Interfaces:**
- Produces:
  - `exportSettingsFile(settings): string`, `importSettingsFile(text)`
  - `exportSessionsFile(sessions): string` (`{ app:"savetabs", kind:"sessions", version:1, exportedAt, sessions }`)
  - `importSessionsFile(text, existing, now): { ok: true; merged: Session[] } | { ok: false; errors: string[] }`
  - Reset chỉ settings; xoá local sessions có confirm riêng.

- [ ] **Step 1: Write failing tests** — settings roundtrip + garbage reject; sessions roundtrip + merge; reset không xoá sessions.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** download/upload; validate schema; cảnh báo plaintext khi export sessions.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add settings and sessions import/export`

### Task 18: Sync key management UI

**Files:**
- Create: `lib/sync/key-store.ts`, `components/SyncSection.tsx`
- Test: `key-store.test.ts`, `SyncSection.test.tsx`

**Interfaces:**
- Produces: `getOrCreateKey()`, `getKey()`, `setKey(key)` (validate), `rotateKey()`; UI reveal/copy/import/rotate; đổi key hỏi "upload session local dưới key mới?" (mặc định có, trừ incognito).

- [ ] **Step 1: Write failing tests** — create once; reject bad key; rotate requires typed confirm; import key triggers upload prompt.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** storage `syncKey`; cảnh báo mất key = mất dữ liệu; nút copy.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add sync key management`

### Task 19: Sessions page

**Files:**
- Create: `entrypoints/sessions/index.html`, `main.tsx`, `App.tsx`, `components/SessionCard.tsx`
- Test: `SessionCard.test.tsx`, `App.test.tsx`

**Interfaces:**
- Consumes: repo, restore, clipboard, settings.
- Produces: card layout A; search; Restore/Copy/rename/export/delete; nhãn Private cho incognito.

- [ ] **Step 1: Write failing tests** — newest first; restore call; copy format; delete confirm; incognito card có nhãn Private.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** 2 cột desktop; display theo `urlDisplay.*`; search title/URL; empty state.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add sessions page`

### Task 20: Popup

**Files:**
- Create: `entrypoints/popup/index.html`, `main.tsx`, `App.tsx`
- Test: `App.test.tsx`

**Interfaces:**
- Consumes: `saveTabs`, repo, settings.
- Produces: "Save N tabs", open sessions, 3 recent, auto-discard status, settings link.

- [ ] **Step 1: Write failing tests** — real count; save call; max 3 recent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** query tabs on mount; storage/BroadcastChannel listener; confirm threshold.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add compact popup`

### Task 21: Incognito + shortcuts info + settings coverage

**Files:**
- Create: `lib/incognito.ts`, `components/ShortcutsInfo.tsx`
- Modify: `CategorySection.tsx`
- Test: `incognito.test.ts`, `ShortcutsInfo.test.tsx`, `packages/shared/src/settings-coverage.test.ts`

**Interfaces:**
- Produces: `isIncognitoAllowed()`, `listShortcuts()`; coverage test đọc source extension.

- [ ] **Step 1: Write failing tests** — incognito access states; real command bindings; mọi `SETTING_KEYS` xuất hiện ≥1 lần trong `apps/extension/**/*.{ts,tsx}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** status row + hướng dẫn; shortcuts từ `commands.getAll()`; coverage dùng `fs`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add incognito and shortcuts info`

---

## Phase 2 — Worker + Sync

### Task 22: Worker scaffold, auth, key auto-register

**Files:**
- Create: `apps/worker/package.json`, `wrangler.toml`, `vitest.config.ts`
- Create: `migrations/0001_init.sql`, `src/index.ts`, `src/env.ts`, `src/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Produces: `Env`; `sha256Hex`, `timingSafeEqual`; `GET /v1/health`; `PUT` auto-register key.
- Migration: `keys`, `sessions`, `deletions`, `counters` (day, requests, keys_created).

- [ ] **Step 1: Write failing test** — health 200; first PUT 201 + tạo key; bearer sai 401; GET chưa có key 404.
- [ ] **Step 2: Run** `pnpm --filter @savetabs/worker test` → FAIL.
- [ ] **Step 3: Implement** Hono; auth middleware hash bearer; constant-time compare; upsert `last_seen_at`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(worker): add auth and key registration`

### Task 23: Sessions CRUD, deletions, bulk blobs, quotas, CORS, rate limit

**Files:**
- Create: `src/routes/sessions.ts`, `src/quota.ts`, `src/cors.ts`, `src/counters.ts`
- Test: `test/sessions.test.ts`

**Interfaces:**
- Produces đủ endpoint spec §6.3: list, get, put, delete (+deletions), delete key, `GET /blobs?page&pageSize`, `GET /deletions`; lỗi chuẩn; global caps.

- [ ] **Step 1: Write failing tests**

```ts
it("CRUDs and tombstones deletes", async () => {
  // put 201 → list 1 → get → delete 204 → list 0 → deletions has id
});
it("serves blobs in pages of 50", async () => { /* 60 sessions → page0 50, nextPage 1; page1 10 */ });
it("rejects oversized and over-quota payloads", async () => { /* 413, 409 */ });
it("enforces global daily cap", async () => { /* counters over limit → 429 capacity_exceeded */ });
it("answers CORS for WEB_ORIGIN", async () => { /* OPTIONS */ });
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** size check trước ghi; đếm sessions/bytes; tombstone insert; bulk query `LIMIT/OFFSET`; counters upsert; CORS; rate limit binding.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(worker): add session CRUD and quotas`

### Task 24: Version endpoint (R2)

**Files:**
- Create: `src/routes/version.ts`
- Test: `test/version.test.ts`

**Interfaces:**
- Produces: `GET /v1/version` đọc `versions.json` R2; `Cache-Control: public, max-age=300`; 404 `not_found`.

- [ ] **Step 1: Write failing test** — seed R2 object; assert JSON + cache header; missing → 404.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** đọc/parse/cache.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(worker): add version endpoint`

### Task 25: Shared SyncClient + extension sync service

**Files:**
- Create: `packages/shared/src/api/sync-client.ts`
- Create: `apps/extension/lib/sync/sync-service.ts`
- Test: `packages/shared/src/api/sync-client.test.ts`, `apps/extension/lib/sync/sync-service.test.ts`

**Interfaces:**
- Produces:
  - `SyncClient` với `listSummaries()`, `listBlobs(page, pageSize)`, `get(id)`, `put(id, ciphertext, updatedAt)`, `delete(id)`, `listDeletions()`, `deleteAll()`; throws `SyncAuthError` on 401.
  - `syncNow(): Promise<{ uploaded; downloaded; deleted; errors }>`
  - `enqueueUpload(session)` — reject nếu `incognito`, reject nếu blob > `maxSessionBytes`, set `pendingUpload` khi lỗi mạng.
  - `applyRemoteDeletions(deletions)`.

- [ ] **Step 1: Write failing tests**

```ts
it("never uploads incognito sessions", async () => {
  await enqueueUpload({ ...session, incognito: true });
  expect(putSpy).not.toHaveBeenCalled();
});
it("blocks oversized sessions before upload", async () => {
  await expect(enqueueUpload(makeSessionWithBytes(LIMITS.maxSessionBytes + 1))).rejects.toThrow(/exceeds/);
});
it("surfaces wrong key as auth error, not empty state", async () => {
  // fetch 401 → syncNow errors includes "unauthorized"
});
it("applies remote tombstones", async () => {
  // local session updatedAt 5, remote deletion 6 → deleted locally
});
it("merges and retries pendingUpload", async () => { /* fail then success clears flag */ });
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** derive keys; list + blobs pages + deletions; decrypt; merge; upload dirty (skip incognito/oversize); 401 → SyncAuthError; tombstone local 30 ngày.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add E2EE sync client and service`

### Task 26: Options sync section wiring

**Files:**
- Create: `components/SyncStatus.tsx`
- Modify: `components/SyncSection.tsx`, `App.tsx`
- Test: `SyncStatus.test.tsx`

**Interfaces:**
- Consumes: `syncNow`, `getKey`, settings.
- Produces: "Sync now", last sync, pending count, auth error banner, "Delete cloud data" (confirm).

- [ ] **Step 1: Write failing tests** — enable requires key confirmation; sync shows counts; 401 shows banner; delete cloud data confirm.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** hook + storage listener; disable sync giữ cloud; nút xoá riêng.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): wire sync settings UI`

---

## Phase 3 — Web app

### Task 27: Web scaffold + landing/key entry

**Files:**
- Create: `apps/web/package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`
- Create: `src/main.tsx`, `src/App.tsx`, `src/pages/Landing.tsx`, `src/lib/key-session.ts`
- Test: `key-session.test.ts`, `Landing.test.tsx`

**Interfaces:**
- Produces: `saveKeyForSession`, `loadKey`, `clearKey` (sessionStorage); `deriveForWeb(key)`; route `/` → `/sessions`.

- [ ] **Step 1: Write failing tests** — invalid key error; valid navigates; i18n/theme render.
- [ ] **Step 2: Run** `pnpm --filter @savetabs/web test` → FAIL.
- [ ] **Step 3: Implement** react-router-dom; i18n; cảnh báo mất key; optional "remember on this device".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): add landing and key entry`

### Task 28: Web sessions page

**Files:**
- Create: `src/pages/Sessions.tsx`, `src/components/SessionCard.tsx`
- Test: `Sessions.test.tsx`

**Interfaces:**
- Consumes: `SyncClient` (bulk pages), `decryptSession`, key session.
- Produces: render cards; open/copy/delete/export; 401 → banner + "đổi key".

- [ ] **Step 1: Write failing tests** — decrypt fixture via mocked fetch; 401 ≠ empty; delete confirm.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** fetch pages 50; 2 cột; i18n; incognito sessions không xuất hiện (không có trên server).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): add session viewing and actions`

### Task 29: Privacy page, CSP headers, E2E smoke

**Files:**
- Create: `src/pages/Privacy.tsx`, `public/_headers`, `playwright.config.ts`, `e2e/web.spec.ts`

**Interfaces:**
- Produces: CSP; privacy policy; e2e key→sessions→decrypt với API mock.

- [ ] **Step 1: Write failing e2e**
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/web.spec.ts` → FAIL.
- [ ] **Step 3: Implement** privacy content (dữ liệu, E2EE, incognito local-only, xoá, liên hệ); headers; fixture.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): add privacy page, CSP, e2e smoke`

---

## Phase 4 — Release (live deploy + store submission)

> **Prerequisites:** Cloudflare account + domain; GitHub remote; Chrome Web Store + AMO credentials. Task 32/34 dừng và báo BLOCKED nếu thiếu — không tạo tài khoản thay chủ dự án.

### Task 30: Extension version check

**Files:**
- Create: `apps/extension/lib/version-check.ts`
- Modify: `entrypoints/background.ts`, options/popup banner
- Test: `version-check.test.ts`

**Interfaces:**
- Produces: `checkForUpdate(fetchImpl?)`, `storeListingUrl(browser)`, alarm `version-check` 24h, badge `↑`.

- [ ] **Step 1: Write failing tests** — same version false; newer true; network error null.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** semver compare; lưu `latestVersion`; banner i18n.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extension): add update check`

### Task 31: Icons, store metadata, zip builds

**Files:**
- Create: `assets/icon.svg`, `scripts/generate-icons.mjs`, `scripts/verify-build.mjs`
- Create: `apps/extension/store/description.md`, `store/privacy-notes.md`
- Verify: build commands

**Interfaces:**
- Produces: PNG 16/32/48/128; `savetabs-<version>-chrome.zip`, `-firefox.zip`; verify script.

- [ ] **Step 1: Write verification script** — assert manifest fields + icons exist.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** icon SVG → sharp; store copy (en + vi); scripts `icons`, `zip:*`.
- [ ] **Step 4: Run** `pnpm icons && pnpm zip:chrome && pnpm zip:firefox && node scripts/verify-build.mjs` → PASS.
- [ ] **Step 5: Commit** `chore(extension): add icons and store assets`

### Task 32: Deploy live (Cloudflare)

**Files:**
- Create: `.env.example`, `apps/worker/wrangler.toml` production env, `docs/deployment-guide.md` (nếu chưa có)
- Verify: live endpoints

**Interfaces:**
- Produces: Worker tại `API_ORIGIN`, web tại `WEB_ORIGIN`, D1 migrated, R2 bucket, Pages project, custom domain.

- [ ] **Step 1: Preflight** — kiểm tra `wrangler whoami`, domain, `SAVETABS_API_BASE`, `WEB_ORIGIN`; thiếu → BLOCKED.
- [ ] **Step 2: Create resources** — `wrangler d1 create savetabs`, `wrangler r2 bucket create savetabs-releases`, Pages project; ghi ID vào wrangler.toml.
- [ ] **Step 3: Migrate + deploy** — `wrangler d1 migrations apply savetabs --remote`, `wrangler deploy`, `wrangler pages deploy apps/web/dist --project-name savetabs`.
- [ ] **Step 4: Verify live** — `curl https://<api>/v1/health` → `{ok:true}`; mở web, nhập key, lưu/đọc thử một session; upload `versions.json` mẫu lên R2.
- [ ] **Step 5: Commit** `chore: add production deployment config`

### Task 33: CI pipeline + release script

**Files:**
- Create: `.github/workflows/ci.yml`, `release.yml`, `scripts/update-versions.mjs`, `README.md`

**Interfaces:**
- Produces: CI typecheck/test/build; release upload R2 + deploy; `versions.json` sync; store submit khi có secrets.

- [ ] **Step 1: Write workflows + script**
- [ ] **Step 2: Dry-run** `node scripts/update-versions.mjs --check` → FAIL nếu version lệch.
- [ ] **Step 3: Implement** version sync, CI cache pnpm, artifact upload.
- [ ] **Step 4: Verify** `pnpm typecheck && pnpm test && pnpm build` → PASS; push nhánh và xem CI chạy.
- [ ] **Step 5: Commit** `ci: add release pipeline`

### Task 34: Store submission (Chrome + Firefox)

**Files:**
- Create: `docs/store-submission.md` (checklist + credentials locations, không chứa secrets)
- Modify: `apps/extension/wxt.config.ts` nếu store yêu cầu
- Verify: listing live

**Interfaces:**
- Produces: extension được submit/approved trên cả hai store; `versions.json` trỏ bản đã publish.

- [ ] **Step 1: Preflight** — kiểm tra Chrome/AMO credentials + privacy policy URL live; thiếu → BLOCKED.
- [ ] **Step 2: Submit Chrome** — `wxt submit --chrome-zip ...` hoặc upload thủ công; điền single purpose, justification cho `tabs`, screenshot 1280×800.
- [ ] **Step 3: Submit Firefox** — AMO zip + source nếu bị yêu cầu; gecko id đúng.
- [ ] **Step 4: Verify** — cả hai listing public; cài từ store trên profile sạch; smoke test Save/Restore/Discard; cập nhật `versions.json`.
- [ ] **Step 5: Commit** `docs: add store submission checklist`

---

## Self-Review (đã chạy khi viết plan)

- **Spec coverage:** §1–§16 đều có task. Các bổ sung sau review: IndexedDB (Task 10), synced tombstones (Task 7/22/23/25), bulk endpoint + caps (Task 23/25/28), incognito local-only (Task 11/19/25), bulk session export/import (Task 17), deploy live + store submit (Task 32/34).
- **Type consistency:** `Settings` key string; `Session.incognito?: boolean` dùng xuyên suốt; `Tombstone` shared; `SyncClient` methods khớp Task 25/28.
- **Review Focus:** 5 dòng đều có test ở Task 11, 25/28, 7/23/25, 25, 14.
- **Prerequisites:** Task 32/34 yêu cầu tài khoản/domain/credentials thật; nếu thiếu, executor phải dừng với `BLOCKED`, không tự tạo tài khoản.

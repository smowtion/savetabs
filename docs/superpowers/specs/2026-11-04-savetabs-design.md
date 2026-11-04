# SaveTabs — Thiết kế kỹ thuật v1

- **Ngày:** 2026-11-04
- **Trạng thái:** chờ chủ dự án duyệt
- **Nguồn:** trao đổi brainstorming + spec gốc của chủ dự án

---

## 1. Bối cảnh & mục tiêu

Chủ dự án mở quá nhiều tab khiến Chrome lag. OneTab giải quyết được việc đóng tab nhưng không có sync thật, UI options cũ và không có tính năng giảm RAM chủ động. SaveTabs là extension độc lập (không can thiệp vào OneTab) có ba phần:

1. **Extension** cho Chrome/Edge/Brave (MV3) và Firefox: lưu toàn bộ tab thành session, đóng tab, xem lại/restore, tự động discard tab không dùng để trả RAM, và một trang Options compact.
2. **Backend sync-key** trên Cloudflare (Worker + D1): đồng bộ session giữa các máy/profile bằng một key duy nhất, mã hoá đầu-cuối (E2EE).
3. **Web app** trên Cloudflare Pages: nhập key để xem/restore session từ bất kỳ trình duyệt nào.

**Thành công của v1:** bấm "Save Tabs" thì tab đóng, RAM giảm; mở lại đúng danh sách tab; đổi máy nhập key là thấy session; options page thay thế được danh sách setting dài dòng của OneTab mà không có nút/thiết lập giả.

---

## 2. Phạm vi

### 2.1 Trong phạm vi v1

- Chrome, Edge, Brave, Opera (Chromium, MV3) và Firefox (MV3) — cùng một codebase WXT.
- Save Tabs (một cửa sổ hoặc tất cả cửa sổ), đóng tab sau khi lưu.
- Trang Sessions dạng card (layout A đã duyệt), restore từng session, copy link, rename, delete.
- Auto-discard tab không hoạt động sau 30 phút (chỉnh được).
- Options page layout A: sidebar + accordion, search tức thời, expand/collapse all, reset, import/export, light/dark/system, auto-save.
- Sync E2EE qua Cloudflare Worker + D1, key do client sinh.
- Web app nhập key để xem/restore/export session.
- i18n en + vi, mặc định theo ngôn ngữ trình duyệt.
- Incognito: chỉ lưu local, không bao giờ sync; mặc định tắt.
- Deploy live Cloudflare (Worker + D1 + R2 + Pages) và submit Chrome Web Store + Firefox Add-ons (AMO); artifact + `versions.json` lưu trên R2.

### 2.2 Ngoài phạm vi (non-goals)

- Safari (cần wrapper Xcode riêng).
- Điều khiển/cấu hình OneTab; nhập dữ liệu trực tiếp từ storage của OneTab (không có API chính thức).
- Tài khoản email/mật khẩu, đăng nhập, multi-user, chia sẻ session theo nhóm.
- Đồng bộ settings giữa các máy (chỉ session được sync).
- Xoá cache trình duyệt (xem §7.11).
- Content script can thiệp vào trang web.
- Mobile app.

### 2.3 Anti-goals

- Không có setting/button nào không dẫn tới hành vi thật.
- Không lưu URL dạng plaintext trên server.
- Không dùng remote code, không eval, không analytics bên thứ ba.

---

## 3. Quyết định đã chốt với chủ dự án

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | Extension riêng tên SaveTabs, không phải UI cho OneTab | repo trống, greenfield |
| 2 | Có backend sync-key ngay bản đầu + web app | Cloudflare Pages/Worker |
| 3 | E2EE bằng key; mất key = mất dữ liệu | server chỉ giữ blob mã hoá |
| 4 | Auto-discard tab sau 30 phút, user chọn thời gian | giảm RAM |
| 5 | Phát hành Chrome Web Store + Firefox Add-ons | store lo auto-update |
| 6 | Quản lý version trên R2 + extension tự check bản mới | chỉ hiện thông báo, không tự thay code |
| 7 | i18n, mặc định theo ngôn ngữ trình duyệt | en + vi |
| 8 | Options: layout A (sidebar + accordion) | mockup đã duyệt |
| 9 | Sessions: layout A (session cards) | mockup đã duyệt |
| 10 | Domain chưa đăng ký | base URL đặt qua env, đổi sau không sửa code |
| 11 | Bàn giao: deploy live + submit cả hai store | cần Cloudflare account, GitHub remote, store credentials, domain thật |
| 12 | Chống abuse: rate limit per-IP/per-key + global caps | không Turnstile ở v1 |
| 13 | Incognito: lưu local, không sync, mặc định tắt | session đánh dấu Private |

---

## 4. Kiến trúc tổng thể

```
┌────────────────────────────┐        ┌────────────────────────────┐
│  Extension (WXT + React)   │        │  Web app (Vite + React)    │
│  Chrome MV3 / Firefox MV3  │        │  Cloudflare Pages          │
│                            │        │                            │
│  options / popup / sessions│        │  nhập key → giải mã client │
│  background service worker │        │  xem / restore / export    │
└─────────────┬──────────────┘        └─────────────┬──────────────┘
              │                                      │
              │  HTTPS: authId + authKey (bearer)    │
              │  body: AES-GCM ciphertext            │
              ▼                                      ▼
      ┌──────────────────────────────────────────────────┐
      │  Cloudflare Worker  (API, rate limit, quota)     │
      │  GET /v1/version      (đọc R2 versions.json)     │
      │  CRUD /v1/keys/{authId}/sessions/{sessionId}     │
      └───────────┬──────────────────────────┬───────────┘
                  │                          │
            ┌─────▼─────┐              ┌─────▼─────┐
            │ D1 (SQLite)│              │ R2 bucket │
            │ keys,     │              │ releases, │
            │ sessions  │              │ versions  │
            └───────────┘              └───────────┘
```

### 4.1 Monorepo (pnpm workspaces)

```
SaveTabs/
├── apps/
│   ├── extension/          # WXT + React + Tailwind + Zustand
│   ├── web/                # Vite + React + Tailwind
│   └── worker/             # Cloudflare Worker + D1 migrations + Wrangler
├── packages/
│   └── shared/             # crypto, types, settings schema, session utils,
│                           # duplicate matcher, i18n dictionaries
├── docs/
├── plans/
├── pnpm-workspace.yaml
└── package.json
```

- `packages/shared` là TypeScript source được cả ba app import trực tiếp (Vite/WXT/Wrangler đều xử lý được TS workspace).
- Không dùng Turborepo/Nx ở v1 (YAGNI); chỉ pnpm scripts.

---

## 5. Mô hình dữ liệu

### 5.1 Session (client-side, plaintext trước khi mã hoá)

```ts
type SavedTab = {
  url: string;          // chỉ http/https (và file:// nếu bật includeFileUrls)
  title: string;
  favIconUrl?: string;  // có thể là data: URI do Chrome trả về
  pinned?: boolean;
};

type Session = {
  id: string;           // crypto.randomUUID()
  createdAt: number;    // epoch ms
  updatedAt: number;    // epoch ms
  title?: string;       // user rename, mặc định "Today · 11:42 AM" (render)
  source: "window" | "all-windows" | "tab" | "selection";
  tabs: SavedTab[];
  pendingUpload?: boolean; // local-only, không gửi lên server
};
```

- Lưu local trong **IndexedDB** (`savetabs` DB, store `sessions`, index `updatedAt`) — không dùng `chrome.storage.local` cho session vì quota 10MB và rewrite toàn mảng. Settings vẫn nằm trong `chrome.storage.local`.
- Đồng bộ giữa các trang và service worker qua `BroadcastChannel("savetabs-events")`, fallback `storage.onChanged`.
- Giới hạn local: 500 session hoặc 15.000 tab; đạt 90% → cảnh báo; đạt 100% → chặn save mới, yêu cầu export/xoá (không âm thầm evict).
- Favicon: chỉ nhận `favIconUrl` nếu chuỗi < 2KB; ưu tiên URL remote, bỏ data: URI lớn.

### 5.2 Settings schema (typed, mọi setting đều có hành vi thật)

`packages/shared/src/settings-schema.ts` định nghĩa một mảng category → setting. Mỗi setting có:

```ts
type SettingDef =
  | { key: string; type: "boolean"; default: boolean; minVersion?: number }
  | { key: string; type: "enum"; values: string[]; default: string }
  | { key: string; type: "number"; default: number; min: number; max: number; step?: number }
  | { key: string; type: "string-list"; default: string[]; maxItems: number };
```

Mỗi setting bắt buộc có `labelKey` + `descriptionKey` (i18n) và được một nơi trong code đọc bằng `getSetting(key)`. Setting không được đọc ở đâu sẽ bị coi là bug (có test kiểm tra coverage).

**Bảng setting v1:**

| Category | Key | Kiểu | Default | Hành vi thật |
|---|---|---|---|---|
| **General** | `general.theme` | enum system/light/dark | system | đổi theme mọi trang extension + web, lưu local |
| | `general.language` | enum auto/en/vi | auto | chọn dictionary i18n |
| | `general.showBadgeCount` | boolean | true | badge hiện tổng số tab đã lưu; tắt → badge trống |
| | `general.confirmThreshold` | number 0–500 | 20 | nếu số tab sắp đóng > N thì hiện confirm; 0 = không hỏi |
| **Tab Management** | `tabs.saveAllWindows` | boolean | false | lưu mọi cửa sổ normal (không gồm incognito trừ khi bật) |
| | `tabs.closeAfterSave` | boolean | true | đóng các tab đã lưu sau khi lưu |
| | `tabs.skipAudible` | boolean | false | bỏ qua tab đang phát âm thanh khi lưu |
| | `tabs.excludedDomains` | string-list | [] | domain không bao giờ lưu và không auto-discard |
| | `tabs.includeFileUrls` | boolean | false | cho phép lưu `file://` (cần quyền file URLs) |
| **Duplicate Handling** | `duplicates.removeOnSave` | boolean | true | khử URL trùng trong cùng session |
| | `duplicates.matchMode` | enum exact/ignore-hash/ignore-query | exact | cách so trùng |
| | `duplicates.skipAlreadySaved` | boolean | false | bỏ URL đã có trong session khác |
| **Pinned Tabs** | `pinned.skipOnSave` | boolean | true | không lưu tab pinned |
| | `pinned.restoreAsPinned` | boolean | true | tab gốc pinned được tạo lại dạng pinned |
| **Open Behavior** | `open.toolbarAction` | enum popup/save/sessions | popup | click icon: mở popup / lưu ngay / mở trang sessions |
| | `open.openSessionsAfterSave` | boolean | true | sau khi lưu mở trang sessions |
| | `open.reuseSessionsTab` | boolean | true | tái dùng tab sessions đang mở thay vì tạo mới |
| **URL Display** | `urlDisplay.mode` | enum title/domain/full-url | title | cách hiển thị link trong sessions card |
| | `urlDisplay.showFavicons` | boolean | true | hiện favicon cạnh link |
| | `urlDisplay.showTabCount` | boolean | true | hiện badge số tab trên header session |
| **Tab Restoration** | `restore.targetWindow` | enum current/new | current | mở tab restore trong cửa sổ hiện tại hay cửa sổ mới |
| | `restore.openInBackground` | boolean | true | tab restore không cướp focus |
| | `restore.skipExisting` | boolean | false | bỏ qua URL đang mở sẵn |
| **Clipboard Formatting** | `clipboard.format` | enum plain-urls/markdown/titled | plain-urls | định dạng khi bấm Copy |
| **Context Menu** | `contextMenu.enabled` | boolean | true | bật/tắt toàn bộ menu |
| | `contextMenu.saveTab` | boolean | true | item "Save this tab" |
| | `contextMenu.saveWindow` | boolean | true | item "Save all tabs in window" |
| | `contextMenu.saveSelection` | boolean | true | item "Save selected tabs" |
| **Memory Optimization** | `memory.autoDiscard` | boolean | true | bật auto-discard |
| | `memory.timeoutMinutes` | enum 5/15/30/60/120 | 30 | ngưỡng không hoạt động |
| | `memory.keepAudible` | boolean | true | không discard tab đang phát âm thanh |
| | `memory.keepPinned` | boolean | true | không discard tab pinned |
| **Keyboard Shortcuts** | *(không có setting)* | — | — | hiển thị binding thật từ `commands.getAll()`; hướng dẫn đổi phím |
| **Incognito** | `incognito.includeInSaveAll` | boolean | false | khi extension được phép incognito, gộp cả cửa sổ incognito vào save-all |
| **Sync & Backup** | `sync.enabled` | boolean | false | bật sync E2EE; key sinh sẵn khi cài |
| | `sync.autoUpload` | boolean | true | tự upload session mới sau khi lưu |
| | `sync.autoDownload` | boolean | true | tự merge session từ server khi khởi động |
| **Advanced** | *(hành động)* | — | — | export/import settings, reset defaults, xoá local, xem dung lượng |

Tổng cộng **36 setting** + các action. Sidebar hiển thị số setting/category tính động từ schema, không hardcode.

**Ghi chú so với spec gốc:**
- "Open OneTab Behavior" đổi thành "Open Behavior" (ta không điều khiển OneTab).
- Thêm category "Sync & Backup" (spec gốc không có).
- "Incognito" chỉ còn 1 setting thật + dòng trạng thái quyền incognito (browser quản lý quyền này, extension không tự bật được).
- "Keyboard Shortcuts" là màn hình thông tin thật (binding hiện tại + hướng dẫn), không có toggle giả.

### 5.3 D1 schema

```sql
CREATE TABLE keys (
  auth_id       TEXT PRIMARY KEY,
  key_hash      TEXT NOT NULL,      -- SHA-256 hex của authKey (bearer)
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  auth_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  ciphertext  BLOB NOT NULL,        -- IV || AES-GCM ciphertext
  updated_at  INTEGER NOT NULL,
  size        INTEGER NOT NULL,     -- bytes
  PRIMARY KEY (auth_id, session_id)
);

CREATE INDEX idx_sessions_auth_updated
  ON sessions (auth_id, updated_at DESC);

CREATE TABLE deletions (
  auth_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  deleted_at  INTEGER NOT NULL,
  PRIMARY KEY (auth_id, session_id)
);
```

- Xoá key/session thực hiện bằng câu lệnh tường minh trong Worker (không dựa vào FK cascade của SQLite).
- Xoá session ghi vào `deletions` (giữ 30 ngày) để máy khác không upload lại; client nhận tombstone khi list.
- `key_hash` không thể suy ngược ra authKey; DB leak không cho phép đọc URL (E2EE) và không cho phép ghi (thiếu authKey).

### 5.4 R2 layout

```
savetabs-releases/
├── versions.json            # { extension: { chrome, firefox }, notesUrl, updatedAt }
├── chrome/savetabs-<ver>.zip
├── firefox/savetabs-<ver>.zip
└── changelog/<ver>.md
```

---

## 6. Bảo mật: E2EE & sync protocol

### 6.1 Sinh key & derive

- Key người dùng: **128 bit ngẫu nhiên** (crypto.getRandomValues), mã hoá dạng Crockford Base32, tiền tố `ST-`, nhóm 5 ký tự: `ST-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` (26 ký tự dữ liệu).
- Parser chấp nhận chữ thường/hoa, bỏ dấu `-`, map ký tự nhập nhằng (I/L→1, O→0).
- Từ key thô, dùng HKDF-SHA256 với salt cố định `savetabs-v1` sinh ra ba giá trị độc lập:
  - `authId` = 128 bit, base64url → định danh công khai trên server.
  - `authKey` = 256 bit, base64url → bearer secret gửi trong header.
  - `encKey` = 256 bit → import thành AES-GCM key, **không bao giờ rời client**.

```ts
const base = await crypto.subtle.importKey("raw", rawKey, "HKDF", false, ["deriveBits"]);
const authId  = b64url(await deriveBits(base, "auth-id", 128));
const authKey = b64url(await deriveBits(base, "auth-key", 256));
const encKey  = await crypto.subtle.deriveKey(
  { name: "HKDF", hash: "SHA-256", salt: enc("savetabs-v1"), info: enc("enc-key") },
  base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
```

- Server lưu `SHA-256(authKey)`; mọi request gửi `Authorization: Bearer <authKey>` + `authId` trên path.
- Lần PUT đầu tiên tự tạo row trong `keys` (auto-register). GET khi chưa có key → 404.
- So sánh hash bằng constant-time compare.

### 6.2 Mã hoá payload

- Mỗi session mã hoá riêng: `ciphertext = AES-GCM(encKey, IV 12 byte ngẫu nhiên, JSON(session))`.
- AAD = `utf8("savetabs:v1:" + authId + ":" + sessionId)` để chống tráo blob giữa session/key.
- Blob lưu server = `base64url(IV || ciphertext)`.
- Metadata server thấy được: authId, sessionId (UUID), updatedAt, size. Nội dung URL/title chỉ client đọc được.

### 6.3 API

| Method | Path | Body / Auth | Kết quả |
|---|---|---|---|
| GET | `/v1/health` | — | `{ ok: true }` |
| GET | `/v1/version` | — | `{ extension: { chrome, firefox }, notesUrl, updatedAt }` (cache 5 phút, đọc R2) |
| GET | `/v1/keys/{authId}/sessions` | Bearer | `{ sessions: [{ id, updatedAt, size }] }` |
| GET | `/v1/keys/{authId}/sessions/{id}` | Bearer | `{ id, ciphertext, updatedAt }` |
| PUT | `/v1/keys/{authId}/sessions/{id}` | Bearer | 200/201 |
| DELETE | `/v1/keys/{authId}/sessions/{id}` | Bearer | 204 (ghi tombstone vào `deletions`) |
| DELETE | `/v1/keys/{authId}` | Bearer | 204 (xoá toàn bộ dữ liệu) |
| GET | `/v1/keys/{authId}/blobs?page=0&pageSize=50` | Bearer | `{ blobs: [{id, ciphertext, updatedAt}], nextPage? }` — bulk tải ciphertext |
| GET | `/v1/keys/{authId}/deletions` | Bearer | `{ deletions: [{id, deletedAt}] }` |

- Lỗi chuẩn: `{ error: { code, message } }`; codes: `unauthorized`, `not_found`, `quota_exceeded`, `payload_too_large`, `invalid_request`, `rate_limited`.
- CORS: chỉ cho origin của web app (env `WEB_ORIGIN`) + extension (origin `chrome-extension://<id>` không gửi Origin ổn định — dùng `*` cho GET/PUT với auth bearer, không cookie; ghi rõ trong code).
- Rate limit: theo IP 120 req/phút; theo authId 240 req/phút; global caps theo ngày (env `GLOBAL_DAILY_REQUESTS`, `GLOBAL_MAX_KEYS`) → 429 `capacity_exceeded` khi vượt.
- Key chưa tồn tại: GET/DELETE trả 404 `not_found`. Vì authId là hàm của key, key gõ sai tạo ra một authId khác và không thể phân biệt với key mới; client hiển thị trạng thái "no data for this key" kèm gợi ý kiểm tra key, không hiển thị empty-success chung chung.

### 6.4 Merge & conflict

- Server không merge (không đọc được nội dung). Client merge theo `session.id`:
  - `updatedAt` mới hơn thắng (last-write-wins) cho cùng id.
  - Session chỉ có ở một bên → thêm vào.
  - Xoá: tombstone được đồng bộ qua server (`deletions`, giữ 30 ngày). Client gửi DELETE; máy khác thấy tombstone trong list và xoá local nếu tombstone mới hơn session. Tombstone local vẫn giữ để chống race.
- Merge chạy: lúc khởi động (nếu `sync.autoDownload`), sau khi save (nếu `sync.autoUpload`), và nút "Sync now".
- Upload lỗi → `pendingUpload = true`, retry ở alarm 5 phút và lần sync kế tiếp.

### 6.5 Quota & giới hạn

| Giới hạn | Giá trị | Xử lý |
|---|---|---|
| 1 session blob | 256 KiB | 413 `payload_too_large`; client chặn trước khi gửi, gợi ý tách session |
| tab / session | 500 | client cắt + cảnh báo |
| session / key | 200 | 409 `quota_exceeded` |
| tổng dung lượng / key | 5 MiB | 409 `quota_exceeded` |
| session local | 500 / 15.000 tab | cảnh báo, yêu cầu export/xoá |

- Vượt 500 tab/session: lưu 500 tab đầu, các tab còn lại **để nguyên mở**, hiện cảnh báo.
- Session > 256 KiB: vẫn lưu local, **bỏ qua sync** với trạng thái rõ ràng; gợi ý export/split.
- Chạm quota server: session mới nhất được ưu tiên sync; phần còn lại hiện "not synced", không xoá.

### 6.6 Threat model (v1)

- **Server/DB leak:** kẻ tấn công thấy authId, hash authKey, blob mã hoá, timestamp. Không đọc được URL, không ghi được (thiếu authKey).
- **Mất key:** không có recovery; UI cảnh báo rõ khi tạo key và bắt xác nhận đã lưu key trước khi bật sync.
- **Key bị lộ:** người có key đọc/ghi/xoá được toàn bộ dữ liệu của key đó. Không có cơ chế thu hồi ngoài "rotate key" (tạo key mới, upload lại, xoá key cũ).
- **XSS web app:** React auto-escape; CSP chặn inline script; không render HTML từ session.
- **URL độc hại:** khi restore chỉ mở http/https/file; hiển thị domain để người dùng thấy đích thật.

---

## 7. Extension

### 7.1 Entrypoints (WXT)

```
apps/extension/
├── entrypoints/
│   ├── background.ts          # service worker
│   ├── popup/                 # popup React
│   ├── options/               # options dashboard React
│   └── sessions/              # trang sessions React (mở như tab)
├── components/                # Accordion, SettingRow, Toggle, Select, SearchBar,
│                              # SettingsSidebar, Tooltip, SessionCard, ConfirmDialog
├── lib/
│   ├── settings.ts            # load/save/migrate settings
│   ├── sessions.ts            # save/restore/merge/duplicate
│   ├── discard.ts             # logic auto-discard
│   ├── sync/                  # client API + crypto wrapper
│   ├── i18n.ts
│   └── messaging.ts           # typed runtime messages giữa pages và background
├── assets/icon/               # 16/32/48/128
├── wxt.config.ts
└── package.json
```

- **Không có content script.**
- `options` và `sessions` là trang full-tab; `popup` là popup 360×420.
- Zustand store cho settings (hydrate từ storage, subscribe `storage.onChanged`) và cho sessions UI.

### 7.2 Luồng Save Tabs

1. Xác định phạm vi: cửa sổ hiện tại, hoặc tất cả cửa sổ normal nếu `tabs.saveAllWindows`; nếu `incognito.includeInSaveAll` và được phép incognito thì gộp cả cửa sổ incognito.
2. Lọc tab:
   - bỏ tab pinned nếu `pinned.skipOnSave`;
   - bỏ tab audible nếu `tabs.skipAudible`;
   - bỏ domain trong `tabs.excludedDomains`;
   - bỏ scheme không restore được (`chrome://`, `edge://`, `about:`, `chrome-extension://`, `devtools://`); `file://` chỉ khi `tabs.includeFileUrls`;
   - khử trùng theo `duplicates.*`; bỏ URL đã có trong session khác nếu `skipAlreadySaved`.
3. Nếu rỗng → toast "No tabs to save", không tạo session.
4. Nếu số tab sắp đóng > `general.confirmThreshold` (>0) → dialog xác nhận.
5. Tạo `Session`, ghi vào IndexedDB (mới nhất trước, tối đa 500 tab; phần dư để nguyên tab mở + cảnh báo). Session lưu từ incognito được đánh dấu `incognito: true` và không bao giờ upload.
6. Nếu `tabs.closeAfterSave` → đóng các tab đã lưu (không đóng tab sessions page).
7. Nếu `open.openSessionsAfterSave` → mở/tái dùng trang sessions.
8. Nếu sync bật + `autoUpload` → mã hoá và PUT; lỗi thì đánh dấu `pendingUpload`.
9. Cập nhật badge.

### 7.3 Trang Sessions (layout A)

- Header: logo, search session (theo title + URL/title bên trong), nút "+ Save window", theme toggle.
- Danh sách card, mới nhất trước:
  - Header card: thời gian tương đối + badge số tab (nếu `urlDisplay.showTabCount`), action `Restore`, `Copy`, `⋯` (Rename, Export session JSON, Delete).
  - Body: link xếp 2 cột desktop / 1 cột mobile; hiển thị theo `urlDisplay.mode`; favicon nếu bật; click mở tab; hover hiện domain đầy đủ (tooltip) để chống link giả.
- Card collapsed/expanded: mặc định mở card mới nhất, các card cũ có nút expand.
- Empty state hướng dẫn bấm "Save Tabs".
- Search realtime; filter cả title session và URL/title tab.

### 7.4 Restore

- `restore.targetWindow = current`: tạo tab trong cửa sổ hiện tại; `= new`: tạo cửa sổ mới.
- Thứ tự tab giữ nguyên; `restore.openInBackground` quyết định `active: false/true`.
- Tab gốc pinned + `pinned.restoreAsPinned` → tạo với `pinned: true`.
- `restore.skipExisting` → so URL đã normalize (bỏ hash nếu matchMode ignore-hash) với tab đang mở.
- Session **không bị xoá** sau restore (an toàn); người dùng tự Delete.
- Web app "restore" = mở từng URL bằng `window.open` khi user bấm (tránh popup blocker); có nút "Open all" kèm cảnh báo.

### 7.5 Auto-discard

- Theo dõi tab hoạt động: `tabs.onActivated`, `tabs.onUpdated` (status = complete), `windows.onFocusChanged`, `tabs.onRemoved`.
- Lưu `lastActiveAt` theo tabId trong `storage.session` (MV3 storage.session; Firefox dùng storage.session nếu có, fallback `storage.local` có prefix và dọn khi khởi động). Ưu tiên `tab.lastAccessed` nếu trình duyệt cung cấp.
- Alarm mỗi phút: quét tab, discard nếu:
  - không phải tab active;
  - `!discarded`;
  - không pinned (nếu `keepPinned`), không audible (nếu `keepAudible`);
  - URL không thuộc `tabs.excludedDomains`;
  - `now - lastActiveAt >= timeoutMinutes`.
- Gọi `chrome.tabs.discard(tabId)` / `browser.tabs.discard(tabId)`; bỏ qua lỗi (tab đã đóng).
- Action "Discard now" trong Options và popup dùng cùng logic, bỏ qua ngưỡng thời gian.
- Firefox: kiểm tra `browser.tabs.discard` tồn tại ở minimum version; nếu thiếu, ẩn tính năng trên Firefox (không hiện setting giả).
- Không dùng `chrome.browsingData` (xem §7.11).

### 7.6 Duplicate handling

- `matchMode`: `exact` (URL y hệt), `ignore-hash` (bỏ `#...`), `ignore-query` (bỏ `?...`).
- `removeOnSave`: giữ tab xuất hiện đầu tiên theo thứ tự tab.
- `skipAlreadySaved`: so với toàn bộ session local (và session đã sync nếu có).

### 7.7 Context menu & keyboard shortcuts

- Context menu tạo/xoá theo setting, dùng `chrome.contextMenus`:
  - "Save this tab" (page/tab);
  - "Save all tabs in this window";
  - "Save selected tabs" (multi-select tab context).
- Commands (gợi ý, user đổi được trong trình duyệt):
  - `save-tabs` → `Alt+Shift+S`
  - `open-sessions` → `Alt+Shift+O`
  - `discard-now` → `Alt+Shift+D`
- Trang Options category "Keyboard Shortcuts": hiển thị binding thật qua `commands.getAll()` + hướng dẫn đổi phím (không thể mở `chrome://extensions/shortcuts` bằng `tabs.create`; chỉ có nút Copy chuỗi URL và mô tả đường dẫn).

### 7.8 Popup

- 360×420, compact:
  - header: SaveTabs + trạng thái sync (icon nhỏ);
  - nút chính: "Save N tabs" (N tính realtime);
  - nút phụ: "Open sessions page";
  - trạng thái auto-discard: "Auto-discard: 30 min" + số tab đã discard hôm nay (đếm local);
  - 3 session gần nhất: thời gian + số tab + nút Restore;
  - link "Settings".
- Không có setting trong popup (tránh trùng lặp); mọi thay đổi ở Options.

### 7.9 Options UI (layout A)

- **Sidebar 220px**: logo, 14 category + số setting, active state; thu gọn thành dropdown ở <900px.
- **Header content**: search input (Cmd/Ctrl+K focus, Esc clear), theme toggle, Expand all / Collapse all.
- **Accordion sections**: header có tên + badge số setting + mô tả ngắn; mở/đóng lưu trạng thái trong `storage.local` (`ui.openSections`).
- **Setting row compact**: label + tooltip (icon ⓘ) + control bên phải; description hiển thị dưới label ở dạng nhỏ, chỉ khi cần.
- **Desktop ≥1280px**: các row trong section xếp 2 cột khi đồng nhất chiều cao; row dạng textarea (excludedDomains) span 2 cột.
- **Search**: lọc theo label/description/keywords i18n; khi có query → hiện kết quả phẳng theo category, tự expand, highlight match.
- **Auto-save**: mỗi thay đổi ghi debounce 200ms + indicator "Saved".
- **Reset to defaults**: confirm dialog, chỉ reset settings (không xoá session).
- **Import/Export settings**: JSON có header `{ app: "savetabs", kind: "settings", version: 1, exportedAt, settings }`; validate bằng zod; lỗi hiện danh sách field sai.
- **Export/Import sessions**: file JSON plaintext (có cảnh báo), là đường recovery khi mất key; import validate schema và gộp bằng merge rules.
- **Accessibility**: control dùng `<button role="switch">`, `<select>`, label liên kết; điều hướng bàn phím; contrast AA.

### 7.10 Đảm bảo không có setting giả

- Test `settings-coverage.test.ts`: mọi key trong schema phải được tham chiếu bởi ít nhất một module hành vi (grep theo key qua registry `SETTING_CONSUMERS` do code export).
- Các action (export/import/reset/rotate key) đều là nút thật, không phải placeholder.
- Category "Keyboard Shortcuts" chỉ hiển thị dữ liệu thật từ `commands.getAll()`.

### 7.11 Vì sao không có "clear cache"

- `chrome.browsingData` chỉ xoá cache đĩa, **không giải phóng RAM của tab đang mở**, và làm lần tải sau chậm hơn.
- Tính năng giảm RAM thật là auto-discard (`chrome.tabs.discard`) — đã có trong Memory Optimization.
- Vì vậy v1 không có nút "clear cache" để tránh nút gây hiểu nhầm. (Quyết định này đã được trao đổi; nếu chủ dự án vẫn muốn, thêm ở v1.1 dưới dạng "Clear browsing cache" với cảnh báo rõ.)

---

## 8. Web app

- Stack: Vite + React + TypeScript + Tailwind + Zustand (nhẹ) + Lucide.
- Route:
  - `/` — landing ngắn + ô nhập key + link privacy;
  - `/sessions` — nếu chưa có key trong sessionStorage → redirect `/`;
  - `/privacy` — chính sách riêng tư (bắt buộc cho store).
- Nhập key → derive authId/authKey/encKey trong browser → list → tải blob theo trang 50 qua bulk endpoint → giải mã → render card giống trang Sessions của extension.
- Hành động: mở link (click từng cái), copy theo format, export session JSON, delete session, "quên key" (xoá khỏi storage), theme toggle, language toggle.
- Key lưu mặc định trong `sessionStorage`; checkbox "Remember on this device" → `localStorage` (cảnh báo).
- Không gửi key lên server; chỉ authId + authKey.
- CSP strict qua `_headers` của Pages; không script bên thứ ba.

---

## 9. Backend & hạ tầng

### 9.1 Worker

- TypeScript + Wrangler; router nhỏ tự viết hoặc Hono (chọn Hono nếu cần middleware CORS/rate limit gọn — quyết định của builder, ưu tiên ít dependency).
- Bindings: `DB` (D1), `RELEASES` (R2), `RATE_LIMITER_IP` + `RATE_LIMITER_AUTH` (Rate Limiting, 120/60s và 240/60s), env `WEB_ORIGIN`, `API_ORIGIN`, `GLOBAL_DAILY_REQUESTS`, `GLOBAL_MAX_KEYS`.
- Global caps: đếm request/ngày và số key tạo mới/ngày trong D1; vượt → 429 `capacity_exceeded`. Không Turnstile ở v1.
- Không log body/ciphertext; log chỉ method, path (đã che authId? authId là public id, giữ được), status, latency.

### 9.2 D1 migrations

- `apps/worker/migrations/0001_init.sql` chứa schema §5.3.
- Script `pnpm db:migrate:local` / `db:migrate:remote` dùng `wrangler d1 migrations apply`.

### 9.3 R2 & version check

- `GET /v1/version` đọc `versions.json` từ R2, cache `Cache-Control: public, max-age=300`.
- Extension alarm mỗi 24h gọi endpoint; nếu version mới hơn `browser.runtime.getManifest().version`:
  - badge `↑` (nếu chưa có badge count ưu tiên khác);
  - banner trong Options + popup với link tới store listing tương ứng trình duyệt.
- Store tự cập nhật binary — extension **không** tự thay code. Endpoint chỉ để thông báo sớm/CHANGELOG.
- Release script upload artifact + cập nhật `versions.json` cùng lúc.

### 9.4 Deploy

- Worker: `wrangler deploy` (env production).
- Web: `wrangler pages deploy apps/web/dist --project-name savetabs`.
- CI (GitHub Actions) các bước: install → lint → typecheck → test → build extension → zip → upload R2 → deploy worker/web → (tuỳ chọn) submit store khi có secrets.
- Secrets store: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CHROME_EXTENSION_ID/CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN`, `FIREFOX_JWT_ISSUER/JWT_SECRET` (WXT submit).

### 9.5 Domain (chưa đăng ký)

- Placeholder env:
  - API: `https://api.savetabs.example` (đổi sau);
  - Web: `https://app.savetabs.example`;
  - `host_permissions` và API origin của extension đọc từ env lúc build; biến chuẩn là `WXT_SAVETABS_API_BASE` (WXT inject qua Vite `define` để manifest và runtime luôn khớp). `SAVETABS_API_BASE` vẫn được chấp nhận như alias; chuỗi rỗng coi như không đặt.
- Khi có domain thật: đổi DNS Cloudflare, cập nhật env + Pages custom domain + `WEB_ORIGIN`; không sửa logic.

---

## 10. i18n

- Dictionary JSON dùng chung: `packages/shared/locales/en.json`, `vi.json`.
- Key dạng `settings.tabs.saveAllWindows.label`, `.description`, `common.restore`, v.v.
- Chọn ngôn ngữ: `general.language = auto` → `navigator.language` bắt đầu bằng `vi` thì dùng vi, còn lại en; `en`/`vi` ép cứng.
- Hook `useI18n()` trong shared: `t(key, vars)` + `lang`; không phụ thuộc thư viện ngoài.
- Web app dùng cùng dictionary để text khớp extension.
- Search setting khớp cả label/description của **ngôn ngữ hiện tại** + keyword ẩn (id, từ đồng nghĩa en/vi) để tìm được kể cả khi UI tiếng Việt.

---

## 11. Privacy & tuân thủ store

- Dữ liệu gửi server: authId, hash(authKey), blob mã hoá, timestamp, kích thước. Không có URL/title dạng đọc được.
- Không analytics, không tracking, không quảng cáo.
- Incognito: session đánh dấu Private, chỉ lưu local, không upload; khai báo rõ trong privacy policy và store listing.
- Server còn lưu counter tổng hợp theo ngày và rate-limit key theo IP/authId; các bản ghi này không chứa URL/title và phải được khai báo trong privacy policy.
- Trang `/privacy` mô tả: dữ liệu nào lưu, ở đâu, E2EE, mất key mất dữ liệu, cách xoá toàn bộ (DELETE key).
- Quyền extension và lý do (dùng cho phần khai báo store):
  - `tabs`: đọc URL/title để lưu và discard tab;
  - `storage`: lưu settings/session local;
  - `alarms`: auto-discard định kỳ + check version;
  - `contextMenus`: menu chuột phải;
  - `activeTab`? không cần.
  - `host_permissions`: chỉ domain API.
- Chrome Web Store: single purpose = "save and restore browser tab sessions"; privacy policy URL; screenshot 1280×800; mô tả quyền.
- Firefox AMO: `browser_specific_settings.gecko.id` (placeholder `savetabs@example.com`, đổi khi có domain), submit source nếu build minified (WXT zip kèm source map? AMO yêu cầu source khi code bị minify — dùng build không minify cho Firefox hoặc nộp source zip).

---

## 12. Testing

| Loại | Công cụ | Phạm vi |
|---|---|---|
| Unit | Vitest | crypto derive/encrypt/decrypt (round-trip, sai key fail, AAD mismatch fail), settings schema defaults/validation/migration, duplicate matcher, discard eligibility, session merge + tombstone, clipboard format |
| Component | Vitest + React Testing Library | Accordion, SettingRow/Toggle, SearchBar filter, Import/Export dialog, SessionCard actions |
| Worker | `@cloudflare/vitest-pool-workers` | auth (bearer sai → 401), auto-register, CRUD, quota 413/409, rate-limit path |
| E2E (smoke) | Playwright | web app với worker local + D1 local: nhập key → thấy session mã hoá giải mã đúng; nhập sai key → lỗi |
| Build | `tsc --noEmit`, `wxt build`, `wxt zip` | cả Chrome và Firefox |

- Không mock hành vi browser trong test logic thuần (tách hàm thuần khỏi `chrome.*`).
- CI chạy toàn bộ trước khi build artifact.

---

## 13. Build & release

- Node 22.12+, pnpm 9+.
- Scripts gốc: `pnpm dev:ext`, `pnpm dev:web`, `pnpm dev:worker`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- Version: semver trong `apps/extension/package.json` + `apps/worker/package.json`; release script đồng bộ `versions.json`.
- Chrome zip: `wxt zip -b chrome`; Firefox zip: `wxt zip -b firefox`. Artifact đặt tên `savetabs-<version>-<browser>.zip`.
- `.superpowers/` thêm vào `.gitignore` (mockup tạm, không commit).
- Không commit secrets; dùng `.env.example` cho env.

---

## 14. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Store review nặng vì quyền `tabs` | Trung bình | mô tả single-purpose rõ, không content script, privacy policy |
| Firefox khác biệt API (`tabs.discard`, `storage.session`, `commands`) | Trung bình | feature-detect; ẩn tính năng nếu thiếu; test trên Firefox thật trước release |
| Mất key → mất dữ liệu | Cao (với user) | cảnh báo + bắt xác nhận đã lưu key; hiển thị key dễ copy; export JSON |
| D1 giới hạn row size / quota free tier | Thấp | cap 256 KiB/session, 5 MiB/key; theo dõi usage |
| Chrome Memory Saver trùng chức năng | Thấp | discard idempotent, không xung đột |
| URL không restore được (`chrome://`, `file://`) | Trung bình | lọc khi save; file:// chỉ khi bật rõ ràng |
| Session lớn (hàng trăm tab) làm chậm UI | Trung bình | collapse card cũ, virtualize danh sách nếu >50 card (cân nhắc ở implementation) |
| R2/Worker free tier | Thấp | cache `/v1/version`; rate limit; nâng plan khi cần |

---

## 15. Những điểm tôi tự quyết (chủ dự án có thể bác)

1. **Monorepo pnpm** 3 app + shared package (thay vì 3 repo riêng).
2. **Trang Sessions là entrypoint riêng** (`sessions.html`) mở dạng tab, không nhúng trong popup.
3. **Key 128-bit Crockford Base32**, derive authId/authKey/encKey; server lưu hash authKey, không lưu key.
4. **Mỗi session là một blob mã hoá riêng** (không phải một document lớn), có tombstone khi xoá.
5. **Settings chỉ lưu local**, không sync; chỉ session sync.
6. **Sync mặc định tắt**; key sinh sẵn khi cài; bật sync phải xác nhận đã lưu key.
7. **Skip pinned mặc định bật**, skip non-http(s) luôn bật; `file://` mặc định tắt.
8. **Auto-discard mặc định 30 phút**, giữ pinned + audible.
9. **Không có "clear cache"**, thay bằng auto-discard.
10. **Không content script**; quyền tối thiểu.
11. **2 cột desktop** hiểu là sidebar | content ở Options, và link 2 cột ở Sessions; row setting 2 cột khi màn hình ≥1280px.
12. **Version check chỉ thông báo**, store lo cập nhật.
13. **Restore không xoá session**; người dùng tự xoá.
14. **Web app read-only** (xem/restore/export/delete), không tạo session từ web.
15. **i18n en+vi** dùng dictionary chung, không dùng `_locales` của browser.i18n.
16. **Sessions lưu trong IndexedDB** (settings vẫn `storage.local`), đồng bộ trang qua BroadcastChannel.
17. **Tombstone đồng bộ qua server** (`deletions`, giữ 30 ngày).
18. **Bulk endpoint `/blobs`** phân trang 50 + rate limit authId 240/phút.
19. **Đổi key**: hỏi "upload session local dưới key mới?" (mặc định có); tắt sync giữ cloud, có nút "Delete cloud data".
20. **Caps**: phần tab dư để nguyên mở; session quá lớn chỉ lưu local; quota đầy không evict.
21. **Bulk export/import session JSON** là đường recovery khi mất key.
22. **Incognito chỉ local**, không sync (đã chốt với chủ dự án).

---

## 16. Câu hỏi mở

- Tên thương hiệu/domain cuối cùng — cần trước khi submit store.
- Cloudflare account, GitHub remote, Chrome/Firefox store credentials — cần trước khi deploy/submit; task tương ứng sẽ block nếu thiếu.
- Có cần đồng bộ settings giữa các máy ở v1.1 không (hiện chỉ session).
- Có cần "Clear browsing cache" như một hành động riêng (có cảnh báo) ở v1.1 không — hiện không đưa vào vì không giảm RAM.

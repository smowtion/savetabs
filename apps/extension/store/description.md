# SaveTabs — store listing copy

Listing copy for the Chrome Web Store and Firefox Add-ons. English is the
primary locale; Vietnamese follows the English text. Every link is a
placeholder until the project domain and store listings exist — replace the
`*.example` URLs before submitting. No ratings, install counts, or user
testimonials are claimed here.

## Name

SaveTabs

## Short description (English, 113/132 characters)

Save open tabs as sessions, restore them later, and keep end-to-end encrypted backups. No accounts, no analytics.

## Full description (English)

SaveTabs turns the tabs in a window into a saved session you can restore later. Save a window in one click, close the tabs to free memory, then reopen the exact set — in the same order — whenever you need it. Everything stays on your device unless you turn on end-to-end encrypted sync.

### Features

- Save the current window or every window as a session from the toolbar, the keyboard shortcut (Alt+Shift+S), or the right-click menu.
- Restore a session into the current or a new window; tab order and pinned state are preserved.
- Sessions page with search, rename, copy links, per-session JSON export, and delete.
- Choose what to skip: pinned tabs, tabs playing audio, excluded domains, and duplicate URLs. Optionally close tabs after saving.
- Automatic discarding of inactive tabs on a schedule where the browser supports it (Chrome-based browsers), to reduce memory use.
- Private/incognito sessions are marked local-only and never uploaded.
- Optional end-to-end encrypted sync across devices using a generated sync key. URLs and titles are encrypted in your browser with AES-GCM 256; the server stores only ciphertext.
- English and Vietnamese interface; light, dark, and system themes.
- No content scripts, no analytics, no ads, and no third-party code.

### Privacy summary

The sync server stores a public account id derived from your sync key, a SHA-256 hash of the derived auth key, encrypted session blobs, timestamps, deletion tombstones, and short-lived rate-limit counters. It never receives your sync key, or readable URLs, page titles, or favicons. If you lose your sync key, synced data cannot be recovered. Delete all cloud data from Settings → Sync → Delete cloud data. Sessions saved from private windows stay on the device.

### Links (placeholders)

- Website: https://savetabs.example/
- Privacy policy: https://savetabs.example/privacy
- Support: contact@savetabs.example
- Chrome Web Store: https://chromewebstore.google.com/detail/savetabs-placeholder
- Firefox Add-ons: https://addons.mozilla.org/firefox/addon/savetabs-placeholder/

## Short description (Vietnamese, 102/132 characters)

Lưu toàn bộ tab thành phiên, khôi phục sau, đồng bộ mã hoá đầu-cuối. Không tài khoản, không analytics.

## Full description (Vietnamese)

SaveTabs lưu các tab đang mở thành một phiên để bạn khôi phục sau. Lưu cả cửa sổ chỉ với một cú nhấp, đóng tab để giải phóng bộ nhớ, rồi mở lại đúng bộ tab đó — đúng thứ tự — khi cần. Mọi dữ liệu nằm trên máy bạn trừ khi bạn bật đồng bộ mã hoá đầu-cuối.

### Tính năng

- Lưu cửa sổ hiện tại hoặc tất cả cửa sổ thành phiên từ thanh công cụ, phím tắt (Alt+Shift+S) hoặc menu chuột phải.
- Khôi phục phiên vào cửa sổ hiện tại hoặc cửa sổ mới; giữ nguyên thứ tự tab và trạng thái ghim.
- Trang Phiên có tìm kiếm, đổi tên, sao chép liên kết, xuất JSON từng phiên và xoá.
- Tuỳ chọn bỏ qua tab ghim, tab đang phát âm thanh, tên miền bị loại trừ và URL trùng. Có thể tự đóng tab sau khi lưu.
- Tự động discard tab không hoạt động theo lịch trên trình duyệt hỗ trợ (dòng Chrome), giúp giảm bộ nhớ.
- Phiên từ cửa sổ riêng tư/ẩn danh được đánh dấu chỉ lưu cục bộ và không bao giờ tải lên.
- Đồng bộ mã hoá đầu-cuối tuỳ chọn giữa các thiết bị bằng khoá đồng bộ được tạo tự động. URL và tiêu đề được mã hoá ngay trong trình duyệt bằng AES-GCM 256; máy chủ chỉ lưu bản mã.
- Giao diện tiếng Anh và tiếng Việt; giao diện sáng, tối và theo hệ thống.
- Không content script, không analytics, không quảng cáo, không mã bên thứ ba.

### Tóm tắt quyền riêng tư

Máy chủ đồng bộ chỉ lưu id tài khoản công khai dẫn xuất từ khoá đồng bộ, hash SHA-256 của auth key dẫn xuất, các blob phiên đã mã hoá, dấu thời gian, tombstone xoá và bộ đếm giới hạn tần suất ngắn hạn. Máy chủ không nhận khoá đồng bộ, URL, tiêu đề hay favicon ở dạng đọc được. Nếu mất khoá đồng bộ, dữ liệu đã đồng bộ không thể khôi phục. Xoá toàn bộ dữ liệu đám mây tại Cài đặt → Đồng bộ → Xoá dữ liệu đám mây. Phiên từ cửa sổ riêng tư chỉ nằm trên máy.

### Liên kết (placeholder)

- Trang web: https://savetabs.example/
- Chính sách riêng tư: https://savetabs.example/privacy
- Hỗ trợ: contact@savetabs.example
- Chrome Web Store: https://chromewebstore.google.com/detail/savetabs-placeholder
- Firefox Add-ons: https://addons.mozilla.org/firefox/addon/savetabs-placeholder/

# SaveTabs — store listing copy

Listing copy for the Chrome Web Store and Firefox Add-ons. English is the
primary locale; Vietnamese follows the English text. The website and privacy
policy point at the live deployment; the support email and store listing URLs
still need real values before submitting. No ratings, install counts, or user
testimonials are claimed here.

## Name

SaveTabs

## Short description (English, 123/132 characters)

Save open tabs as sessions, restore them later, and keep end-to-end encrypted backups. No account needed; sync is optional.

## Full description (English)

SaveTabs turns the tabs in a window into a saved session you can restore later. Save a window in one click, close the tabs to free memory, then reopen the exact set — in the same order — whenever you need it. Everything stays on your device unless you turn on end-to-end encrypted sync.

### Features

- Save the current window or every window as a session from the toolbar, the keyboard shortcut (Alt+Shift+S), or the right-click menu.
- Restore a session into the current or a new window; tab order and pinned state are preserved.
- Sessions page with search, rename, copy links, per-session JSON export, and delete.
- Choose what to skip: pinned tabs, tabs playing audio, excluded domains, and duplicate URLs. Optionally close tabs after saving.
- Automatic discarding of inactive tabs on a schedule where the browser supports it (Chrome-based browsers), to reduce memory use.
- Private/incognito sessions are marked local-only and never uploaded.
- Optional end-to-end encrypted sync across devices using a generated sync key, or an optional account with an email and password that makes sync easier to set up. URLs and titles are encrypted in your browser with AES-GCM 256; the server stores only ciphertext.
- Accounts are optional: the server stores your email, a password-derived proof hash, the key-derivation salt and iteration count, the wrapped sync key, hashed session and email tokens, and daily email counters. Your password, sync key and session contents never reach the server. Your recovery key is your sync key, so losing both your password and your recovery key makes cloud data unrecoverable.
- Interface in English, Vietnamese, and ten more locales; light, dark, and system themes.
- No content scripts, no third-party analytics, trackers, or remote code.

### Privacy summary

The sync server stores a public account id derived from your sync key, a SHA-256 hash of the derived auth key, encrypted session blobs, timestamps, deletion tombstones, and short-lived rate-limit counters. If you create the optional account, it also stores your email address, a password-derived proof hash, the KDF salt and iteration count, the wrapped sync key, hashed session tokens (30 days) and verification or reset tokens (24 hours), and daily email-send counters; verification and password-reset email is delivered through Resend. It never receives your password, sync key, or readable URLs, page titles, or favicons. Your recovery key is your sync key: if you lose both your password and your recovery key, synced data cannot be recovered. Delete all cloud data from Settings → Sync → Delete cloud data. Sessions saved from private windows stay on the device.

### Links

- Website: https://savetabs.azcom.dev/
- Privacy policy: https://savetabs.azcom.dev/privacy
- Support: support@azcom.dev
- Chrome Web Store: https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi
- Firefox Add-ons: (added after AMO submission)

## Short description (Vietnamese, 107/132 characters)

Lưu tab thành phiên, khôi phục sau, đồng bộ mã hoá đầu-cuối tuỳ chọn. Không cần tài khoản, không analytics.

## Full description (Vietnamese)

SaveTabs lưu các tab đang mở thành một phiên để bạn khôi phục sau. Lưu cả cửa sổ chỉ với một cú nhấp, đóng tab để giải phóng bộ nhớ, rồi mở lại đúng bộ tab đó — đúng thứ tự — khi cần. Mọi dữ liệu nằm trên máy bạn trừ khi bạn bật đồng bộ mã hoá đầu-cuối.

### Tính năng

- Lưu cửa sổ hiện tại hoặc tất cả cửa sổ thành phiên từ thanh công cụ, phím tắt (Alt+Shift+S) hoặc menu chuột phải.
- Khôi phục phiên vào cửa sổ hiện tại hoặc cửa sổ mới; giữ nguyên thứ tự tab và trạng thái ghim.
- Trang Phiên có tìm kiếm, đổi tên, sao chép liên kết, xuất JSON từng phiên và xoá.
- Tuỳ chọn bỏ qua tab ghim, tab đang phát âm thanh, tên miền bị loại trừ và URL trùng. Có thể tự đóng tab sau khi lưu.
- Tự động discard tab không hoạt động theo lịch trên trình duyệt hỗ trợ (dòng Chrome), giúp giảm bộ nhớ.
- Phiên từ cửa sổ riêng tư/ẩn danh được đánh dấu chỉ lưu cục bộ và không bao giờ tải lên.
- Đồng bộ mã hoá đầu-cuối tuỳ chọn giữa các thiết bị bằng khoá đồng bộ được tạo tự động, hoặc bằng tài khoản tuỳ chọn với email và mật khẩu giúp thiết lập đồng bộ dễ hơn. URL và tiêu đề được mã hoá ngay trong trình duyệt bằng AES-GCM 256; máy chủ chỉ lưu bản mã.
- Tài khoản là tuỳ chọn: máy chủ lưu email, mã băm bằng chứng dẫn xuất từ mật khẩu, muối và số vòng lặp KDF, khoá đồng bộ đã được bọc, token phiên và token email đã băm, cùng bộ đếm email theo ngày. Mật khẩu, khoá đồng bộ và nội dung phiên không bao giờ tới máy chủ. Khoá khôi phục chính là khoá đồng bộ, nên nếu mất cả mật khẩu lẫn khoá khôi phục thì dữ liệu đám mây không thể khôi phục.
- Giao diện bằng tiếng Anh, tiếng Việt và mười ngôn ngữ khác; giao diện sáng, tối và theo hệ thống.
- Không content script, không công cụ phân tích, trình theo dõi hay mã từ xa của bên thứ ba.

### Tóm tắt quyền riêng tư

Máy chủ đồng bộ lưu id tài khoản công khai dẫn xuất từ khoá đồng bộ, hash SHA-256 của auth key dẫn xuất, các blob phiên đã mã hoá, dấu thời gian, tombstone xoá và bộ đếm giới hạn tần suất ngắn hạn. Nếu bạn tạo tài khoản tuỳ chọn, máy chủ cũng lưu địa chỉ email, mã băm bằng chứng dẫn xuất từ mật khẩu, muối và số vòng lặp KDF, khoá đồng bộ đã bọc, token phiên (30 ngày) và token xác minh/đặt lại (24 giờ) đã băm, cùng bộ đếm email gửi mỗi ngày; email xác minh và đặt lại mật khẩu được gửi qua Resend. Máy chủ không nhận mật khẩu, khoá đồng bộ, URL, tiêu đề hay favicon ở dạng đọc được. Khoá khôi phục chính là khoá đồng bộ: nếu mất cả mật khẩu lẫn khoá khôi phục, dữ liệu đã đồng bộ không thể khôi phục. Xoá toàn bộ dữ liệu đám mây tại Cài đặt → Đồng bộ → Xoá dữ liệu đám mây. Phiên từ cửa sổ riêng tư chỉ nằm trên máy.

### Liên kết

- Trang web: https://savetabs.azcom.dev/
- Chính sách riêng tư: https://savetabs.azcom.dev/privacy
- Hỗ trợ: support@azcom.dev
- Chrome Web Store: https://chromewebstore.google.com/detail/ajejilnkhplcpgcjfkidkdepjipmocfi
- Firefox Add-ons: (thêm sau khi nộp AMO)

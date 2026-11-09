# Safari Web Extension guide

SaveTabs ships the same WXT/React code to Safari as an MV3 Safari Web
Extension. Safari distribution is different from Chrome/Firefox: the built
folder must be converted into an Xcode project and signed with an Apple
Developer account.

## Requirements

- macOS with Xcode 15+ and Command Line Tools (`xcode-select --install`).
- Safari 16.4+ for MV3; Safari 18+ recommended for current WebExtension APIs.
- Apple Developer Program membership for distribution (Mac App Store / iOS).
  Local development with a free Apple ID works for a personal-team build.

## 1. Build the Safari target

```bash
cd ~/Workingspace/SaveTabs
export WXT_SAVETABS_API_BASE=https://savetabs-api.azcom.dev
export WXT_SAVETABS_VERSION_URL=https://savetabs.azcom.dev/versions.json
pnpm --filter @savetabs/extension build:safari
```

Output: `apps/extension/.output/safari-mv3/`.

The manifest is MV3 and uses `background.service_worker`. The Worker CORS
allowlist accepts `safari-web-extension://…` origins, so deploy the Worker
before testing sync.

## 2. Convert to an Xcode project

```bash
pnpm --filter @savetabs/extension safari:convert
```

Equivalent direct command:

```bash
xcrun safari-web-extension-converter \
  apps/extension/.output/safari-mv3 \
  --project-location apps/extension/.output/safari-project \
  --app-name SaveTabs \
  --bundle-identifier com.azcom.savetabs \
  --force
```

Open `apps/extension/.output/safari-project/SaveTabs.xcodeproj` in Xcode,
select the app target, choose your signing team, and run the macOS app.

For local unsigned testing: Safari → Settings → Advanced → enable **Show
features for web developers**, then Develop → **Allow Unsigned Extensions**
(this resets when Safari restarts). Enable SaveTabs in Safari → Settings →
Extensions.

## 3. Test checklist

- Popup save, restore, language picker and sync card.
- Saved sessions page: view mode, full-URL textarea, copy.
- Options page: settings persistence, import/export, sync.
- Context menus, keyboard shortcuts (support varies by Safari version).
- Sync: enable in the popup, save a session, open `/sessions` on the web.
- Auto-discard is hidden on Safari because `tabs.discard` is not available;
  the feature-detection path should show no dead controls.

## 4. Distribution

1. Enroll in the Apple Developer Program.
2. In Xcode: set a unique bundle identifier, version/build number, signing
   team, and archive the app.
3. Upload to App Store Connect, complete the Safari extension metadata,
   screenshots, privacy answers, and submit for review.
4. iOS/iPadOS: the converter also generates an iOS target; it needs its own
   App Store listing and review.

There is no Chrome-style ZIP upload for Safari. The Mac App Store (or a
notarized Developer ID app for direct distribution, where supported) is the
delivery path.

## Known Safari limitations

- `tabs.discard` is unavailable, so auto-discard is hidden.
- Keyboard `commands` support varies; the popup, context menu and sessions page
  remain the reliable entry points.
- Safari may ask for host access separately; the extension needs
  `https://savetabs-api.azcom.dev/*` for optional sync and
  `https://savetabs.azcom.dev/*` for the static update manifest.
- Safari screenshots/listing text should not use the Chrome-badged promo
  images; use the actual UI screenshots instead.

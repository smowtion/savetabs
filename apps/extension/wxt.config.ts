import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// WXT_SAVETABS_API_BASE is the canonical name; SAVETABS_API_BASE is accepted
// as an alias so older deploy scripts keep working. `||` (not `??`) treats an
// empty value as unset. The origin is injected below so the manifest host
// permission and the runtime client always read the same value.
const apiBase = (
  process.env.WXT_SAVETABS_API_BASE ||
  process.env.SAVETABS_API_BASE ||
  "https://api.savetabs.example"
).replace(/\/+$/, "");

// One raster set shared by the extension listing and the toolbar button. The
// files are generated from `assets/icon.svg` and committed under `public/`.
const ICON_PATHS = {
  16: "icon/icon-16.png",
  32: "icon/icon-32.png",
  48: "icon/icon-48.png",
  128: "icon/icon-128.png",
};

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  // Store artifacts are named savetabs-<version>-<browser>.zip. Without the
  // explicit template WXT derives the prefix from the scoped package name and
  // produces "savetabsextension-...".
  zip: {
    name: "savetabs",
    artifactTemplate: "savetabs-{{version}}-{{browser}}{{modeSuffix}}.zip",
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      "import.meta.env.WXT_SAVETABS_API_BASE": JSON.stringify(apiBase),
    },
  }),
  manifest: ({ browser }) => ({
    name: "SaveTabs",
    description: "Save and restore browser tab sessions.",
    permissions: ["tabs", "storage", "alarms", "contextMenus"],
    icons: ICON_PATHS,
    // The background configures the toolbar action at runtime (popup vs click
    // handler), so the manifest must declare it. The popup entrypoint later
    // merges `default_popup` into this key.
    action: {
      default_icon: ICON_PATHS,
    },
    host_permissions: [`${apiBase}/*`],
    commands: {
      "save-tabs": {
        suggested_key: { default: "Alt+Shift+S" },
        description: "Save all tabs in the current window",
      },
      "open-sessions": {
        suggested_key: { default: "Alt+Shift+O" },
        description: "Open the sessions page",
      },
      "discard-now": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "Discard inactive tabs now",
      },
    },
    browser_specific_settings:
      browser === "firefox"
        ? {
            gecko: {
              id: "savetabs@example.com",
              strict_min_version: "121.0",
            },
          }
        : undefined,
  }),
});

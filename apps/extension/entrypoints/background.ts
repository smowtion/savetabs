export default defineBackground(() => {
  // Placeholder background entrypoint. Message routing, toolbar actions,
  // context menus, alarms and install/startup wiring are added later.
  browser.runtime.onInstalled.addListener(() => {});
});

import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Account tests run real PBKDF2 (600k iterations) and the UI suites
    // share the CPU with the other packages in the recursive run; the 5s
    // default flakes under that load.
    testTimeout: 30000,
  },
});

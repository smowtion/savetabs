import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Account tests run real PBKDF2 (600k iterations); under the recursive
    // test run the 5s default flakes on CPU contention.
    testTimeout: 30000,
    // Playwright owns e2e/; Vitest would otherwise collect *.spec.ts there.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});

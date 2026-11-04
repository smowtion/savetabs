import type { D1Migration } from "cloudflare:test";

// TEST_MIGRATIONS is a Miniflare binding injected by vitest.config.ts; it is
// test-only, so it is declared here rather than in src/env.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

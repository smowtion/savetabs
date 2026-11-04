import { applyD1Migrations, env } from "cloudflare:test";

// Apply the canonical migration SQL once per test worker; isolated storage
// treats the migrated schema as the baseline for every test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

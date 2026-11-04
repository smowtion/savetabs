/** Cloudflare bindings available to the SaveTabs sync Worker. */
export interface Env {
  /** D1 database holding key hashes, encrypted sessions and tombstones. */
  DB: D1Database;
  /** R2 bucket holding release artifacts and versions.json. */
  RELEASES: R2Bucket;
  /** Web app origin allowed to make cross-origin requests (used in Task 23). */
  WEB_ORIGIN: string;
  /**
   * Global daily request cap. Wrangler vars arrive as strings, so callers
   * parse it before comparing (Task 23).
   */
  GLOBAL_DAILY_REQUESTS: string;
  /** Maximum number of sync keys the service accepts (Task 23). */
  GLOBAL_MAX_KEYS: string;
  /** Optional Cloudflare rate-limiting binding (Task 23). */
  RATE_LIMITER?: RateLimiterBinding;
}

/** The subset of the Cloudflare rate-limit binding used by this Worker. */
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// `cloudflare:test` types `env` as `Cloudflare.Env`; extend it with the
// bindings above so tests see the same contract as the Worker.
type WorkerEnv = Env;

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

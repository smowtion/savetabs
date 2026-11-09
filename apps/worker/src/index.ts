import { Hono } from "hono";
import { cleanupUnverifiedAccounts } from "./accounts/cleanup";
import { corsMiddleware } from "./cors";
import { ipRateLimitMiddleware } from "./counters";
import type { Env } from "./env";
import { apiError } from "./errors";
import { accountsRoutes } from "./routes/accounts";
import { sessionsRoutes } from "./routes/sessions";
import { versionRoutes } from "./routes/version";

export const app = new Hono<{ Bindings: Env }>();

// Order matters: CORS answers preflight and exits before the abuse controls so
// a browser preflight never receives an API error response. The IP bucket runs
// before authentication; the authId bucket is charged inside the routes once a
// bearer has been verified. Platform request limits replace the old D1-backed
// daily counter, which wrote one row per request.
app.use("*", corsMiddleware);
app.use("*", ipRateLimitMiddleware);

app.get("/v1/health", (c) => c.json({ ok: true }));

app.route("/v1", versionRoutes);
app.route("/v1", sessionsRoutes);
app.route("/v1", accountsRoutes);

app.notFound((c) => apiError(c, 404, "not_found", "Route not found."));

app.onError((error, c) => {
  console.error("Unhandled worker error", error);
  return apiError(c, 500, "internal_error", "Unexpected server error.");
});

/**
 * Cron entry point (see `[triggers]` in wrangler.toml). Runs the retention
 * sweep for accounts that never verified their email address.
 */
async function scheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const deleted = await cleanupUnverifiedAccounts(
    env.DB,
    controller.scheduledTime,
  );
  console.log("cleanup_unverified_accounts", { deleted });
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

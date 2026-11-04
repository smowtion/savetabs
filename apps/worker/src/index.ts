import { Hono } from "hono";
import { corsMiddleware } from "./cors";
import { capacityMiddleware, ipRateLimitMiddleware } from "./counters";
import type { Env } from "./env";
import { apiError } from "./errors";
import { sessionsRoutes } from "./routes/sessions";
import { versionRoutes } from "./routes/version";

const app = new Hono<{ Bindings: Env }>();

// Order matters: CORS answers preflight and exits before the abuse controls so
// a browser preflight never receives an API error response. The IP bucket runs
// before authentication; the authId bucket is charged inside the routes once a
// bearer has been verified.
app.use("*", corsMiddleware);
app.use("*", capacityMiddleware);
app.use("*", ipRateLimitMiddleware);

app.get("/v1/health", (c) => c.json({ ok: true }));

app.route("/v1", versionRoutes);
app.route("/v1", sessionsRoutes);

app.notFound((c) => apiError(c, 404, "not_found", "Route not found."));

app.onError((error, c) => {
  console.error("Unhandled worker error", error);
  return apiError(c, 500, "internal_error", "Unexpected server error.");
});

export default app;

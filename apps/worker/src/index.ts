import { Hono } from "hono";
import { corsMiddleware } from "./cors";
import { capacityMiddleware, rateLimitMiddleware } from "./counters";
import type { Env } from "./env";
import { apiError } from "./errors";
import { sessionsRoutes } from "./routes/sessions";

const app = new Hono<{ Bindings: Env }>();

// Order matters: CORS answers preflight and exits before the abuse controls so
// a browser preflight never receives an API error response.
app.use("*", corsMiddleware);
app.use("*", capacityMiddleware);
app.use("*", rateLimitMiddleware);

app.get("/v1/health", (c) => c.json({ ok: true }));

app.route("/v1", sessionsRoutes);

app.notFound((c) => apiError(c, 404, "not_found", "Route not found."));

app.onError((error, c) => {
  console.error("Unhandled worker error", error);
  return apiError(c, 500, "internal_error", "Unexpected server error.");
});

export default app;

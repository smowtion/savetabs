import { Hono } from "hono";
import type { VersionInfo } from "@savetabs/shared/types";
import type { Env } from "../env";
import { apiError } from "../errors";

/** Object uploaded by the release script alongside the store artifacts. */
const VERSIONS_KEY = "versions.json";

export const versionRoutes = new Hono<{ Bindings: Env }>();

versionRoutes.get("/version", async (c) => {
  const object = await c.env.RELEASES.get(VERSIONS_KEY);
  if (object === null) {
    return apiError(c, 404, "not_found", "Version information not found.");
  }

  let value: unknown;
  try {
    value = await object.json();
  } catch {
    return apiError(
      c,
      500,
      "internal_error",
      "Version information is unavailable.",
    );
  }

  if (!isVersionInfo(value)) {
    return apiError(
      c,
      500,
      "internal_error",
      "Version information is unavailable.",
    );
  }

  // Five minutes: a new release becomes visible quickly without making every
  // extension check read R2.
  c.header("Cache-Control", "public, max-age=300");
  return c.json(value);
});

/**
 * A versions.json that does not match the published contract means the release
 * upload went wrong. Serving it would break the extension's update check, so
 * treat it as a server misconfiguration instead.
 */
function isVersionInfo(value: unknown): value is VersionInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const { extension, notesUrl, updatedAt } = value as Record<string, unknown>;
  if (typeof notesUrl !== "string") return false;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return false;
  if (
    typeof extension !== "object" ||
    extension === null ||
    Array.isArray(extension)
  ) {
    return false;
  }

  const { chrome, firefox } = extension as Record<string, unknown>;
  return typeof chrome === "string" && typeof firefox === "string";
}

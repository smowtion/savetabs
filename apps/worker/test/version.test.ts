import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const BASE_URL = "https://savetabs.test";
const VERSIONS_KEY = "versions.json";

interface ErrorBody {
  error: { code: string; message: string };
}

const VALID_VERSIONS = {
  extension: { chrome: "1.2.3", firefox: "1.2.3" },
  notesUrl: "https://savetabs.pages.dev/releases/1.2.3",
  updatedAt: 1_700_000_000_000,
};

function getVersion(): Promise<Response> {
  return SELF.fetch(`${BASE_URL}/v1/version`);
}

async function seedVersions(body: string): Promise<void> {
  await env.RELEASES.put(VERSIONS_KEY, body);
}

describe("GET /v1/version", () => {
  // R2 writes are visible to later tests in this file, so every test starts
  // from an empty bucket and seeds its own fixture.
  beforeEach(() => env.RELEASES.delete(VERSIONS_KEY));

  it("serves versions.json from R2 without authentication", async () => {
    await seedVersions(JSON.stringify(VALID_VERSIONS));

    const response = await getVersion();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual(VALID_VERSIONS);
  });

  it("returns 404 not_found when versions.json is absent", async () => {
    const response = await getVersion();

    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("not_found");
  });

  it("returns 500 internal_error when versions.json is malformed", async () => {
    await seedVersions("{ this is not json");

    const response = await getVersion();

    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("internal_error");
  });

  it("returns 500 internal_error when versions.json has the wrong shape", async () => {
    await seedVersions(
      JSON.stringify({ extension: { chrome: 1 }, updatedAt: "soon" }),
    );

    const response = await getVersion();

    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("internal_error");
  });
});

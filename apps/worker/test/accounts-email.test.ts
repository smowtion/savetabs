import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { sendEmail, verificationEmail } from "../src/accounts/email";
import {
  createToken,
  hashToken,
  normalizeEmail,
} from "../src/accounts/tokens";
import { sha256Hex } from "../src/auth";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases the address", () => {
    expect(normalizeEmail("  New@Example.COM ")).toBe("new@example.com");
    expect(normalizeEmail("already@example.com")).toBe("already@example.com");
  });
});

describe("account tokens", () => {
  it("creates a 32-byte base64url token with its SHA-256 hash", async () => {
    const { token, tokenHash } = await createToken();

    // 32 bytes encode to 43 unpadded base64url characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(await sha256Hex(token));
  });

  it("creates a fresh token per call", async () => {
    const [first, second] = await Promise.all([createToken(), createToken()]);

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it("hashToken returns the lowercase hex SHA-256 of the bearer", async () => {
    expect(await hashToken("token")).toBe(await sha256Hex("token"));
  });
});

describe("sendEmail", () => {
  it("sends through Resend with the bearer secret", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await sendEmail(
      {
        RESEND_API_KEY: "re_test",
        RESEND_FROM: "SaveTabs <noreply@azcom.dev>",
      } as Env,
      { to: "a@example.com", subject: "S", html: "<p>h</p>", text: "t" },
      async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response("{}", { status: 200 });
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Content-Type"]).toBe("application/json");

    expect(JSON.parse(String(calls[0]?.init.body)) as unknown).toEqual({
      from: "SaveTabs <noreply@azcom.dev>",
      to: "a@example.com",
      subject: "S",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("falls back to the default sender when RESEND_FROM is unset", async () => {
    let from: unknown;
    await sendEmail(
      { RESEND_API_KEY: "re_test" } as Env,
      { to: "a@example.com", subject: "S", html: "h", text: "t" },
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { from: string };
        from = body.from;
        return new Response("{}", { status: 200 });
      },
    );

    expect(from).toBe("SaveTabs <noreply@azcom.dev>");
  });

  it("logs and resolves when Resend reports an error status", async () => {
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      await expect(
        sendEmail(
          { RESEND_API_KEY: "re_test", RESEND_FROM: "x" } as Env,
          { to: "a@b.c", subject: "s", html: "h", text: "t" },
          async () => new Response("{}", { status: 500 }),
        ),
      ).resolves.toBeUndefined();
    } finally {
      console.error = originalError;
    }

    expect(logged).toEqual([["resend_send_failed", { status: 500 }]]);
  });

  it("skips sending when the key is absent", async () => {
    await expect(
      sendEmail(
        { RESEND_FROM: "x" } as Env,
        { to: "a@b.c", subject: "s", html: "h", text: "t" },
        async () => {
          throw new Error("must not be called");
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("verificationEmail", () => {
  const link = "https://savetabs.azcom.dev/verify?token=abc123";

  it("returns a subject, HTML and text containing the link", () => {
    const message = verificationEmail("en", link);

    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toContain(link);
    expect(message.text).toContain(link);
  });

  it("accepts a locale even while the copy is English", () => {
    expect(verificationEmail("vi", link)).toEqual(
      verificationEmail("en", link),
    );
  });
});

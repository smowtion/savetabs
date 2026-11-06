import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  resetEmail,
  sendEmail,
  sendEmailSafely,
  verificationEmail,
} from "../src/accounts/email";
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

describe("sendEmailSafely", () => {
  it("logs and resolves when the provider request rejects", async () => {
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    try {
      await expect(
        sendEmailSafely(
          { RESEND_API_KEY: "re_test", RESEND_FROM: "x" } as Env,
          { to: "a@b.c", subject: "s", html: "h", text: "t" },
          async () => {
            throw new Error("network down");
          },
        ),
      ).resolves.toBeUndefined();
    } finally {
      console.error = originalError;
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toBe("resend_send_rejected");
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

  it("localizes Vietnamese, Arabic and Japanese copy", () => {
    const english = verificationEmail("en", link);

    for (const locale of ["vi", "ar", "ja"]) {
      const message = verificationEmail(locale, link);
      expect(message.subject, locale).not.toBe(english.subject);
      expect(message.text, locale).not.toBe(english.text);
      expect(message.html, locale).toContain(link);
      expect(message.text, locale).toContain(link);
      // The 24-hour expiry promise survives localization.
      expect(message.text, locale).toMatch(/24/);
    }
  });

  it("falls back to English for an unknown locale", () => {
    expect(verificationEmail("xx", link)).toEqual(verificationEmail("en", link));
  });
});

describe("resetEmail", () => {
  const link = "https://savetabs.azcom.dev/reset?token=abc123";

  it("returns a subject, HTML and text containing the link", () => {
    const message = resetEmail("en", link);

    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toContain(link);
    expect(message.text).toContain(link);
  });

  it("localizes every supported locale and falls back to English", () => {
    const english = resetEmail("en", link);

    for (const locale of [
      "vi",
      "zh-CN",
      "es",
      "hi",
      "ar",
      "pt",
      "ru",
      "ja",
      "fr",
      "de",
      "ko",
    ]) {
      const message = resetEmail(locale, link);
      expect(message.subject, locale).not.toBe(english.subject);
      expect(message.text, locale).not.toBe(english.text);
      expect(message.html, locale).toContain(link);
      expect(message.text, locale).toMatch(/24/);
    }

    expect(resetEmail("xx", link)).toEqual(english);
  });
});

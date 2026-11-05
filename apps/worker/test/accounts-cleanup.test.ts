import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "@savetabs/shared/base64url";
import { cleanupUnverifiedAccounts } from "../src/accounts/cleanup";
import { currentDay } from "../src/counters";
import worker from "../src/index";

const DAY_MS = 24 * 60 * 60 * 1000;
const KDF_SALT = toBase64Url(new Uint8Array(16));
const AUTH_HASH = "ab".repeat(32);

interface SeededAccount {
  id: string;
  email: string;
}

let emailSequence = 0;

/**
 * Seed one account. `createdAt` is explicit so the retention boundary can be
 * tested without depending on the wall clock ticking between assertions.
 */
async function seedAccount(
  options: {
    verified?: boolean;
    linked?: boolean;
    createdAt?: number;
  } = {},
): Promise<SeededAccount> {
  const id = crypto.randomUUID();
  emailSequence += 1;
  const email = `cleanup-${emailSequence}@example.com`;
  const createdAt = options.createdAt ?? Date.now();

  await env.DB.prepare(
    `INSERT INTO accounts
       (id, email, auth_hash, kdf_salt, kdf_iterations, wrapped_key, auth_id,
        locale, email_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 'en', ?, ?, ?)`,
  )
    .bind(
      id,
      email,
      AUTH_HASH,
      KDF_SALT,
      600_000,
      options.linked === true ? `auth-${id}` : null,
      options.verified === true ? createdAt : null,
      createdAt,
      createdAt,
    )
    .run();

  return { id, email };
}

/** Give an account one of every row the cleanup is responsible for. */
async function seedChildRows(accountId: string, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO account_tokens
         (token_hash, account_id, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(`token-${accountId}`, accountId, now, now + DAY_MS, now),
    env.DB.prepare(
      `INSERT INTO email_verifications
         (token_hash, account_id, created_at, expires_at, used_at, purpose)
       VALUES (?, ?, ?, ?, NULL, 'verify')`,
    ).bind(`verification-${accountId}`, accountId, now, now + DAY_MS),
    env.DB.prepare(
      "INSERT INTO email_sends (account_id, day, count) VALUES (?, ?, 1)",
    ).bind(accountId, currentDay(now)),
  ]);
}

interface ChildRowCounts {
  tokens: number;
  verifications: number;
  sends: number;
}

async function childRowCounts(accountId: string): Promise<ChildRowCounts> {
  const [tokens, verifications, sends] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM account_tokens WHERE account_id = ?",
    )
      .bind(accountId)
      .first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM email_verifications WHERE account_id = ?",
    )
      .bind(accountId)
      .first<{ total: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM email_sends WHERE account_id = ?",
    )
      .bind(accountId)
      .first<{ total: number }>(),
  ]);

  return {
    tokens: tokens?.total ?? 0,
    verifications: verifications?.total ?? 0,
    sends: sends?.total ?? 0,
  };
}

async function accountExists(id: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM accounts WHERE id = ?")
    .bind(id)
    .first();
  return row !== null;
}

function testExecutionContext(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

describe("cleanupUnverifiedAccounts", () => {
  it("removes only old unverified unlinked accounts", async () => {
    const now = Date.now();
    const old = await seedAccount({ createdAt: now - 31 * DAY_MS });
    const fresh = await seedAccount({ createdAt: now - DAY_MS });
    const linked = await seedAccount({
      linked: true,
      createdAt: now - 31 * DAY_MS,
    });
    const verified = await seedAccount({
      verified: true,
      createdAt: now - 31 * DAY_MS,
    });

    const deleted = await cleanupUnverifiedAccounts(env.DB, now);

    expect(deleted).toBe(1);
    expect(await accountExists(old.id)).toBe(false);
    expect(await accountExists(fresh.id)).toBe(true);
    expect(await accountExists(linked.id)).toBe(true);
    expect(await accountExists(verified.id)).toBe(true);
  });

  it("removes the tokens, verifications and send counters of expired accounts", async () => {
    const now = Date.now();
    const old = await seedAccount({ createdAt: now - 31 * DAY_MS });
    const fresh = await seedAccount({ createdAt: now - DAY_MS });
    await seedChildRows(old.id, now);
    await seedChildRows(fresh.id, now);

    await cleanupUnverifiedAccounts(env.DB, now);

    expect(await childRowCounts(old.id)).toEqual({
      tokens: 0,
      verifications: 0,
      sends: 0,
    });
    expect(await childRowCounts(fresh.id)).toEqual({
      tokens: 1,
      verifications: 1,
      sends: 1,
    });
  });

  it("keeps accounts that reach the 30-day boundary exactly", async () => {
    const now = Date.now();
    const boundary = await seedAccount({ createdAt: now - 30 * DAY_MS });

    expect(await cleanupUnverifiedAccounts(env.DB, now)).toBe(0);
    expect(await accountExists(boundary.id)).toBe(true);
  });

  it("runs the cleanup from the scheduled handler", async () => {
    const now = Date.now();
    const old = await seedAccount({ createdAt: now - 31 * DAY_MS });
    const controller: ScheduledController = {
      scheduledTime: now,
      cron: "17 3 * * *",
      noRetry: () => {},
    };

    await worker.scheduled(controller, env, testExecutionContext());

    expect(await accountExists(old.id)).toBe(false);
  });
});

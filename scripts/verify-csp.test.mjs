import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findCspHeader,
  parseCspDirectives,
  verifyCsp,
} from "./verify-csp.mjs";

/** Build a `_headers` fixture whose CSP has the given connect-src sources. */
function headersFixture(connectSrc) {
  return [
    "# fixture",
    "/*",
    `  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src ${connectSrc}; frame-ancestors 'none'`,
    "  X-Content-Type-Options: nosniff",
    "",
  ].join("\n");
}

test("accepts a connect-src that contains the configured origin", () => {
  assert.deepEqual(
    verifyCsp({
      viteApiBase: "https://api.savetabs.example",
      wxtApiBase: "https://api.savetabs.example/",
      headersText: headersFixture("'self' https://api.savetabs.example"),
    }),
    [],
  );
});

test("normalizes paths and trailing slashes to an origin", () => {
  assert.deepEqual(
    verifyCsp({
      viteApiBase: "https://api.savetabs.example/v1/",
      wxtApiBase: "https://api.savetabs.example",
      headersText: headersFixture("https://api.savetabs.example"),
    }),
    [],
  );
});

test("rejects a CSP that omits the configured origin", () => {
  const errors = verifyCsp({
    viteApiBase: "https://api.savetabs.example",
    headersText: headersFixture("'self'"),
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not allow the API origin/);
});

test("rejects a CSP without a connect-src directive", () => {
  const errors = verifyCsp({
    viteApiBase: "https://api.savetabs.example",
    headersText:
      "/*\n  Content-Security-Policy: default-src 'self'; frame-ancestors 'none'\n",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /no connect-src/);
});

test("rejects a missing CSP header", () => {
  const errors = verifyCsp({
    viteApiBase: "https://api.savetabs.example",
    headersText: "/*\n  X-Content-Type-Options: nosniff\n",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /no Content-Security-Policy/);
});

test("rejects mismatched extension and web origins", () => {
  const errors = verifyCsp({
    viteApiBase: "https://api.savetabs.example",
    wxtApiBase: "https://sync.savetabs.example",
    headersText: headersFixture("https://api.savetabs.example"),
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match VITE_API_BASE origin/);
});

test("fails closed when VITE_API_BASE is unset", () => {
  for (const value of [undefined, "", "  "]) {
    const errors = verifyCsp({
      viteApiBase: value,
      headersText: headersFixture("https://api.savetabs.example"),
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /VITE_API_BASE is not set/);
  }
});

test("rejects invalid and non-http origins", () => {
  const invalid = verifyCsp({
    viteApiBase: "not a url",
    headersText: headersFixture("'self'"),
  });
  assert.equal(invalid.length, 1);
  assert.match(invalid[0], /not a valid absolute URL/);

  const ftp = verifyCsp({
    viteApiBase: "ftp://api.savetabs.example",
    headersText: headersFixture("ftp://api.savetabs.example"),
  });
  assert.equal(ftp.length, 1);
  assert.match(ftp[0], /must use http or https/);
});

test("parses headers and directives case-insensitively", () => {
  const csp = findCspHeader(
    headersFixture("'self' https://api.savetabs.example"),
  );
  assert.ok(csp !== null);

  const directives = parseCspDirectives(csp);
  assert.deepEqual(directives.get("connect-src"), [
    "'self'",
    "https://api.savetabs.example",
  ]);
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
});

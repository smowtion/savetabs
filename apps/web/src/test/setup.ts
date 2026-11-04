import "@testing-library/jest-dom/vitest";

import { webcrypto } from "node:crypto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Testing Library only registers its automatic cleanup when Vitest
// globals are enabled; this project imports test helpers explicitly instead.
afterEach(() => {
  cleanup();
});

// jsdom ships a Crypto object with only getRandomValues. The shared crypto
// modules derive keys with HKDF and decrypt with AES-GCM, so fall back to
// Node's full WebCrypto implementation when the environment lacks it.
if (globalThis.crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

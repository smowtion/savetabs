// `@cloudflare/workers-types` exposes WebCrypto as a global binding but does
// not surface it on `globalThis` for source files outside this package. The
// shared KDF module references `globalThis.crypto` while being Workers-safe at
// runtime, so declare the binding for the worker typecheck.
declare var crypto: Crypto;

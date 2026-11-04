/**
 * Build-time configuration for the web app.
 *
 * `VITE_API_BASE` should point at the deployed sync worker. The placeholder
 * keeps local builds working before a real domain is registered.
 */
const FALLBACK_API_BASE = "https://api.savetabs.example";

export const API_BASE = (
  import.meta.env.VITE_API_BASE || FALLBACK_API_BASE
).replace(/\/+$/, "");

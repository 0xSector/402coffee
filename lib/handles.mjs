// @purpose Edge-safe handle rules (regex + reserved set + validator). Kept dependency-free
//   (no db/viem imports) so middleware.js can import it in the edge runtime. lib/creators.mjs
//   re-exports these so there is a single source of truth for what a valid creator handle is.

export const HANDLE_RE = /^[a-z0-9-]{2,32}$/;

// Handles we never hand out (routes, brand, footguns). First-come-first-served otherwise.
export const RESERVED_HANDLES = new Set([
  "api", "app", "www", "admin", "dashboard", "widget", "t", "c", "wall", "about",
  "terms", "privacy", "docs", "help", "support", "402coffee", "coffee", "static",
  "assets", "public", "favicon", "robots", "sitemap", "well-known", "llms",
  "mcp", "claim", "leaderboard", "search",
]);

export function isValidHandle(h) {
  return typeof h === "string" && HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h);
}

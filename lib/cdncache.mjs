// @purpose Vercel CDN caching for the crawler-facing discovery docs (/openapi.json,
//   /llms.txt, /.well-known/x402[/full]). x402/MCP crawlers poll these every few minutes;
//   uncached, every hit ran a creators query, so the Neon compute never idled long enough
//   to scale to zero. The CDN now serves them for 6h (clients still see the short
//   Cache-Control). A newly claimed jar shows up within 6h; a redeploy clears the cache.
//   Only applied after a successful DB read, so an outage never pins an empty list.

export const DISCOVERY_CDN_CACHE = "max-age=21600, stale-while-revalidate=86400";

/** Add the CDN cache header to `headers` when the DB read succeeded. */
export function withCdnCache(headers, dbOk) {
  return dbOk ? { ...headers, "vercel-cdn-cache-control": DISCOVERY_CDN_CACHE } : headers;
}

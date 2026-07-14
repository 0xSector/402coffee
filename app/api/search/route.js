// @purpose Public creator search. GET /api/search?q=term. Same backing as the MCP
//   search_creators tool. Returns only public fields.

import { searchCreators } from "../../../lib/creators.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const rows = await searchCreators(q, { limit: 20 });
  const results = rows.map((c) => ({
    handle: c.handle, display_name: c.display_name, bio: c.bio,
    tiers: c.tiers, url: `${url.origin}/${c.handle}`, tip: `${url.origin}/t/${c.handle}`,
  }));
  return Response.json({ query: q, results }, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=15" } });
}

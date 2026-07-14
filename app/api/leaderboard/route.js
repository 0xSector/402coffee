// @purpose Site-wide tip leaderboard JSON. GET /api/leaderboard. Public, cached briefly.
//   Feeds the "state of onchain tipping" content flywheel and a future homepage board.

import { leaderboard } from "../../../lib/tips.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const rows = await leaderboard({ limit });
  return Response.json(
    { leaderboard: rows },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" } },
  );
}

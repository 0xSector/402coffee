// @purpose Public supporter wall JSON. GET /api/wall/:handle. Non-hidden tips only,
//   redacted to what's safe to show (no private creator fields). Read by the creator
//   page and the widget's "you're on the wall" step.

import { getCreator } from "../../../../lib/creators.mjs";
import { listWall } from "../../../../lib/tips.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, ctx) {
  const { handle } = await ctx.params;
  const c = await getCreator(handle);
  if (!c) return Response.json({ error: "creator not found" }, { status: 404, headers: cors() });
  const wall = await listWall(handle, { limit: 100 });
  return Response.json({ handle, wall }, { headers: cors() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return { "access-control-allow-origin": "*", "cache-control": "public, max-age=10" };
}

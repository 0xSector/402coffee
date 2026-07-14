// @purpose Public creator profile JSON. GET /api/creators/:handle. This is what the
//   widget, the MCP server, and other clients read to render a tip jar. Never exposes
//   private fields (email, webhook_url) — only whether they're set.

import { getCreator } from "../../../../lib/creators.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, ctx) {
  const { handle } = await ctx.params;
  const c = await getCreator(handle);
  if (!c) return Response.json({ error: "creator not found" }, { status: 404, headers: cors() });
  const { email, webhook_url, ...pub } = c;
  return Response.json(
    { ...pub, has_email: Boolean(email), has_webhook: Boolean(webhook_url) },
    { headers: cors() },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return { "access-control-allow-origin": "*", "cache-control": "public, max-age=15" };
}

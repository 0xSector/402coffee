// @purpose Rich, human/agent-friendly resource index (superset of the standard
//   /.well-known/x402). One entry per creator tier with a semantic description and the
//   exact x402 payment terms, so a semantic search can route "thank the author of X" to
//   the right jar. GET /.well-known/x402/full.

import { listCreators } from "../../../../lib/creators.mjs";
import { withCdnCache } from "../../../../lib/cdncache.mjs";
import { buildRequirements } from "../../../../lib/x402.mjs";
import { activeNetwork } from "../../../../lib/config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = new URL(request.url).origin;
  const net = activeNetwork();
  let creators = [];
  let dbOk = true;
  try { creators = await listCreators({ limit: 500 }); } catch { dbOk = false; }

  const resources = creators.flatMap((c) => {
    const who = c.display_name ? `${c.display_name} (@${c.handle})` : `@${c.handle}`;
    const bio = c.bio ? ` — ${c.bio}` : "";
    return c.tiers.map((t) => ({
      resource: `${origin}/t/${c.handle}?tier=${t.key}`,
      type: "http",
      methods: ["GET", "POST"],
      x402Version: 2,
      scheme: "exact",
      network: net.caip2,
      asset: net.usdc,
      payTo: c.wallet,
      description: `Buy ${who} a ${t.label || t.key}${bio}`,
      amount: buildRequirements({ amountUsd: String(t.usd), payTo: c.wallet, net }).amount,
      amount_usd: t.usd,
      mcp: `${origin}/mcp`,
    }));
  });

  return Response.json(
    {
      x402Version: 2,
      name: "402 Coffee",
      description: "Non-custodial x402 tip jars for the agentic web. Tips settle as USDC straight to each creator's wallet.",
      network: net.caip2,
      asset: net.usdc,
      mcp: `${origin}/mcp`,
      count: resources.length,
      resources,
    },
    { headers: withCdnCache({ "access-control-allow-origin": "*", "cache-control": "public, max-age=60" }, dbOk) },
  );
}

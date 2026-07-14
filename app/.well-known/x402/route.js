// @purpose Machine-readable index of every tip resource on this domain, for x402 crawlers
//   / bazaar-style discovery. GET /.well-known/x402. Each creator's tip endpoint is listed
//   with a human description and the exact payment terms so a semantic search can route
//   "thank the author of X" to the right jar. Non-custodial: payTo is each creator's wallet.

import { listCreators } from "../../../lib/creators.mjs";
import { buildRequirements } from "../../../lib/x402.mjs";
import { activeNetwork } from "../../../lib/config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = new URL(request.url).origin;
  const net = activeNetwork();
  let creators = [];
  try { creators = await listCreators({ limit: 500 }); } catch { creators = []; }

  const resources = creators.flatMap((c) => {
    const base = { network: net.caip2, asset: net.usdc, payTo: c.wallet, scheme: "exact" };
    const who = c.display_name ? `${c.display_name} (@${c.handle})` : `@${c.handle}`;
    const bio = c.bio ? ` — ${c.bio}` : "";
    // one resource per tier so each is a cleanly-describable discovery entry
    return c.tiers.map((t) => ({
      resource: `${origin}/t/${c.handle}?tier=${t.key}`,
      type: "http",
      methods: ["GET", "POST"],
      x402Version: 2,
      description: `Buy ${who} a ${t.label || t.key}${bio}`,
      amount: buildRequirements({ amountUsd: String(t.usd), payTo: c.wallet, net }).amount,
      amount_usd: t.usd,
      mcp: `${origin}/mcp`,
      ...base,
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
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}

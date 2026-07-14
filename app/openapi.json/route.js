// @purpose OpenAPI 3.1 discovery document. GET /openapi.json. This is the format
//   @agentcash/discovery prefers (source "openapi") — the same library agentcash AND
//   x402scan use to index x402 origins. Each creator's tip endpoint is a path with an
//   `x-payment-info` extension (price + x402 protocol) and a 402 response, modeled on the
//   live, known-discoverable stableenrich.dev spec. Generated from the creator table so it
//   stays current as jars are claimed. Non-custodial: each path pays to that creator's own
//   wallet.

import { listCreators } from "../../lib/creators.mjs";
import { activeNetwork } from "../../lib/config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usd6 = (n) => Number(n).toFixed(6);

export async function GET(request) {
  const origin = new URL(request.url).origin;
  const net = activeNetwork();
  let creators = [];
  try { creators = await listCreators({ limit: 500 }); } catch { creators = []; }

  const paths = {};
  for (const c of creators) {
    const tier = c.tiers?.[0] || { key: "coffee", label: "Coffee", usd: 1 };
    const who = c.display_name ? `${c.display_name} (@${c.handle})` : `@${c.handle}`;
    const paymentInfo = {
      price: { mode: "variable", currency: "USD", amount: usd6(tier.usd) },
      protocols: [{ x402: {} }],
    };
    const responses = {
      "200": { description: "Tip settled. Returns a JSON receipt with the settlement tx hash." },
      "402": { description: "Payment Required — x402 challenge (exact scheme, USDC on Base)." },
    };
    const common = {
      tags: ["tips"],
      "x-payment-info": paymentInfo,
      parameters: [
        { name: "amount", in: "query", required: false, schema: { type: "number" }, description: "USD tip amount (clamped to the creator's min/max)." },
        { name: "tier", in: "query", required: false, schema: { type: "string" }, description: "Tier key (e.g. coffee, beer); overrides amount." },
      ],
      responses,
    };
    paths[`/t/${c.handle}`] = {
      get: { operationId: `tip_${c.handle}_get`, summary: `Tip ${who} in USDC`, description: `Send ${who} a USDC tip. Default ${tier.label || tier.key} is $${tier.usd}. Non-custodial — settles straight to their wallet.${c.bio ? " " + c.bio : ""}`, ...common },
      post: { operationId: `tip_${c.handle}_post`, summary: `Tip ${who} in USDC (with message)`, description: `Same as GET, plus an optional JSON body { message, name, url } shown on the supporter wall.`, ...common },
    };
  }

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "402 Coffee",
      description: "Non-custodial x402 tip jars for the agentic web. Humans tip with an in-browser signature (no gas); agents tip over HTTP or MCP. Every tip settles as USDC on Base straight to the creator's own wallet — no custodian, no fee.",
      version: "1.0.0",
      "x-guidance": `# 402 Coffee\n\nEach /t/{handle} endpoint is an x402 'exact' scheme resource on Base USDC (eip155:8453). GET or POST returns HTTP 402 with a payment challenge; pay it with any x402 client and the tip settles to the creator's wallet. Amount is set with ?amount={usd} or ?tier={key}. There is also an MCP server at ${origin}/mcp (tools: get_creator, search_creators, tip) and a discovery index at ${origin}/.well-known/x402.`,
      contact: { name: "402 Coffee", url: origin },
    },
    servers: [{ url: origin }],
    tags: [{ name: "tips", description: "Non-custodial USDC tip endpoints." }],
    "x-discovery": { mcp: `${origin}/mcp`, wellKnown: `${origin}/.well-known/x402` },
    paths,
    components: {},
  };

  return Response.json(spec, {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" },
  });
}

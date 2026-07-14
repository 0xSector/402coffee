// @purpose Hosted MCP server so any agent can discover and tip creators without knowing
//   x402 plumbing. Stateless Streamable-HTTP JSON-RPC (hand-rolled: one POST endpoint,
//   application/json responses) — no session, no server-initiated messages, which is all a
//   tools server needs and keeps it dependency-light + fully auditable. Tools:
//     get_creator(handle)             -> public profile + tiers
//     search_creators(query)          -> find a jar by name/bio
//     tip(handle, amount_usd?, ...)   -> returns the x402 challenge to pay; if you pass a
//                                        signed `payment` (base64 PAYMENT-SIGNATURE) it
//                                        settles and returns the receipt. Non-custodial:
//                                        the server never holds keys — you pay from your
//                                        own x402 wallet.

import { getCreator, searchCreators, isValidHandle } from "../../lib/creators.mjs";
import { resolveAndChallenge, settleAndRecord } from "../../lib/tipflow.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "402coffee", title: "402 Coffee", version: "1.0.0" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,GET,OPTIONS",
  "access-control-allow-headers": "content-type,mcp-protocol-version,mcp-session-id",
};

const TOOLS = [
  {
    name: "get_creator",
    title: "Get a creator's tip jar",
    description: "Look up a 402 Coffee creator by handle. Returns their profile, payout wallet, and tip tiers.",
    inputSchema: { type: "object", properties: { handle: { type: "string", description: "creator handle, e.g. tim" } }, required: ["handle"] },
  },
  {
    name: "search_creators",
    title: "Search tip jars",
    description: "Find a creator's tip jar by name, handle, or bio text.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "search terms" } }, required: ["query"] },
  },
  {
    name: "tip",
    title: "Tip a creator in USDC",
    description:
      "Tip a creator. Without `payment`, returns the x402 payment challenge (an `accepts` array) to pay from your own USDC wallet by POSTing PAYMENT-SIGNATURE to tip_url, or by calling tip again with `payment` set to the base64 PAYMENT-SIGNATURE you produced. Non-custodial: funds settle straight to the creator's wallet.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount_usd: { type: "number", description: "USD amount (clamped to the creator's min/max)" },
        tier: { type: "string", description: "tier key like coffee or beer (overrides amount_usd)" },
        message: { type: "string" },
        name: { type: "string", description: "display name to show on the wall" },
        payment: { type: "string", description: "base64 PAYMENT-SIGNATURE if you've already signed the x402 authorization" },
      },
      required: ["handle"],
    },
  },
];

const money = (u) => "$" + (Number(u) % 1 === 0 ? Number(u).toFixed(0) : Number(u).toFixed(2));

function publicCreator(c) {
  const { email, webhook_url, ...pub } = c;
  return pub;
}

async function callTool(name, args, origin) {
  if (name === "get_creator") {
    const c = await getCreator(args?.handle);
    if (!c) return toolText(`No creator @${args?.handle}.`, { found: false });
    const pub = publicCreator(c);
    const tiers = pub.tiers.map((t) => `${t.label || t.key} ${money(t.usd)}`).join(", ");
    return toolText(`@${pub.handle}${pub.display_name ? ` (${pub.display_name})` : ""} — ${pub.bio || "no bio"}. Tiers: ${tiers}. Tip at ${origin}/t/${pub.handle}.`, pub);
  }

  if (name === "search_creators") {
    const rows = await searchCreators(args?.query, { limit: 20 });
    const list = rows.map(publicCreator).map((c) => ({ handle: c.handle, display_name: c.display_name, bio: c.bio, url: `${origin}/${c.handle}` }));
    return toolText(list.length ? `Found ${list.length}: ${list.map((c) => "@" + c.handle).join(", ")}` : "No matches.", { results: list });
  }

  if (name === "tip") {
    if (!isValidHandle(args?.handle)) return toolText("Invalid handle.", { ok: false }, true);
    const res = await resolveAndChallenge({ handleName: args.handle, tier: args.tier, amount: args.amount_usd, origin });
    if (res.error) return toolText(res.error, { ok: false }, true);

    if (!args.payment) {
      // Discovery: hand back the challenge for the agent's own wallet to pay.
      return toolText(
        `To tip @${args.handle} ${money(res.amountUsd)}: pay this x402 challenge from your USDC wallet, then either POST PAYMENT-SIGNATURE to ${origin}/t/${args.handle}?amount=${res.amountUsd}, or call this tool again with payment=<base64 PAYMENT-SIGNATURE>.`,
        { ok: false, needs_payment: true, tip_url: `${origin}/t/${args.handle}?amount=${res.amountUsd}`, amount_usd: res.amountUsd, x402: res.paymentRequired },
      );
    }

    const out = await settleAndRecord({
      creator: res.creator, handleName: args.handle, amountUsd: res.amountUsd, requirements: res.requirements,
      sig: args.payment, body: { channel: "mcp", message: args.message, name: args.name },
    });
    if (!out.ok) return toolText(`Payment ${out.stage} failed: ${out.reason || out.message}`, { ok: false, stage: out.stage, reason: out.reason }, true);
    return toolText(
      `Tipped @${args.handle} ${money(res.amountUsd)}. Tx ${out.receipt.tx_hash}. On the wall: ${origin}/${args.handle}#wall`,
      { ok: true, receipt: out.receipt },
    );
  }

  return toolText(`Unknown tool: ${name}`, { ok: false }, true);
}

function toolText(text, structured, isError = false) {
  return { content: [{ type: "text", text }], structuredContent: structured, isError };
}

// ---- JSON-RPC plumbing -----------------------------------------------------
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

async function handleRpc(msg, origin) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Discover creators with search_creators/get_creator, then tip() to get a payment challenge you settle from your own USDC wallet.",
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return null; // notification: no response
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      case "tools/call": {
        const out = await callTool(params?.name, params?.arguments || {}, origin);
        return rpcResult(id, out);
      }
      default:
        return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return isNotification ? null : rpcError(id, -32603, String(e?.message || e));
  }
}

export async function POST(request) {
  const origin = new URL(request.url).origin;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }

  const batch = Array.isArray(payload);
  const msgs = batch ? payload : [payload];
  const responses = [];
  for (const m of msgs) {
    const r = await handleRpc(m, origin);
    if (r !== null) responses.push(r);
  }
  if (responses.length === 0) {
    // All notifications -> 202 Accepted, no body.
    return new Response(null, { status: 202, headers: CORS });
  }
  return Response.json(batch ? responses : responses[0], { headers: { ...CORS, "mcp-protocol-version": PROTOCOL_VERSION } });
}

export async function GET() {
  // Stateless server: no SSE stream to open.
  return new Response("MCP endpoint — POST JSON-RPC (Streamable HTTP). Tools: get_creator, search_creators, tip.", {
    status: 200, headers: { ...CORS, "content-type": "text/plain" },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

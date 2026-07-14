// @purpose /llms.txt — tells agents what 402 Coffee is and how to tip. Also documents the
//   proposed convention for creator sites: add a `<link rel="tip">` and an llms.txt tip
//   line so agents that read you know how to thank you. Served as text/plain.

import { listCreators } from "../../lib/creators.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = new URL(request.url).origin;
  let creators = [];
  try { creators = await listCreators({ limit: 50 }); } catch { creators = []; }
  const list = creators.map((c) => `- @${c.handle}${c.display_name ? ` (${c.display_name})` : ""}: ${origin}/${c.handle} — tip ${origin}/t/${c.handle}`).join("\n");

  const body = `# 402 Coffee

Non-custodial x402 tip jars for the agentic web. Every creator has an x402 endpoint and an
MCP tool; tips settle as USDC (Base) straight to the creator's own wallet. No custody, no fee.

## Tip a creator
- MCP: connect ${origin}/mcp and call tip("handle", amount_usd). Without a signed payment it
  returns the x402 challenge for your wallet to pay.
- HTTP: GET ${origin}/t/{handle}?amount={usd} returns a 402 challenge (x402 v2, exact scheme,
  USDC on Base). Pay it with any x402 client and POST back the PAYMENT-SIGNATURE header.
- Discovery index: ${origin}/.well-known/x402

## Convention for creator sites (propose to your users)
Add one line so agents that read you know how to thank you:
  <link rel="tip" href="${origin}/t/{handle}">
and/or an llms.txt line:
  Tip: ${origin}/t/{handle}

## Creators
${list || "(none yet)"}
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120", "access-control-allow-origin": "*" } });
}

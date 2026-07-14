// @purpose The tip endpoint. GET/POST /t/:handle runs the x402 flow via the shared tip
//   core (lib/tipflow): no payment header -> 402 challenge (payTo = creator's own wallet);
//   valid PAYMENT-SIGNATURE -> verify + settle + record + notify, then 200 receipt.
//   Non-custodial: funds go payer -> creator directly; this server holds no keys or money.
//   The MCP tip tool shares the same core, so both front doors behave identically.

import { isValidHandle } from "../../../lib/creators.mjs";
import { resolveAndChallenge, settleAndRecord } from "../../../lib/tipflow.mjs";

export const runtime = "nodejs"; // facilitator client + lazy CDP SDK need Node, not Edge
export const dynamic = "force-dynamic";

const H_SIGNATURE = "PAYMENT-SIGNATURE";
const H_REQUIRED = "PAYMENT-REQUIRED";
const H_RESPONSE = "PAYMENT-RESPONSE";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,PAYMENT-SIGNATURE",
  "access-control-expose-headers": `${H_REQUIRED},${H_RESPONSE}`,
};

function json(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS, ...extraHeaders } });
}

async function handleTip(request, handleName, body) {
  const url = new URL(request.url);
  const res = await resolveAndChallenge({
    handleName,
    tier: url.searchParams.get("tier"),
    amount: url.searchParams.get("amount"),
    origin: url.origin,
  });
  if (res.error) return json({ error: res.error }, res.status);

  const sig = request.headers.get(H_SIGNATURE);
  if (!sig) {
    // Unpaid request -> issue the challenge (body for humans, header for x402 clients).
    return json(res.paymentRequired, 402, { [H_REQUIRED]: res.header });
  }

  const out = await settleAndRecord({
    creator: res.creator, handleName, amountUsd: res.amountUsd, requirements: res.requirements, sig, body,
  });
  if (!out.ok) {
    return json(
      { ...res.paymentRequired, error: `payment ${out.stage} failed: ${out.reason || out.message || "unknown"}` },
      402,
      { [H_REQUIRED]: res.header },
    );
  }
  console.log("[tip settled]", JSON.stringify({ handle: handleName, amount_usd: res.amountUsd, tx: out.receipt.tx_hash, replay: out.replay }));
  return json({ ok: true, replay: out.replay, receipt: out.receipt }, 200, out.responseHeader ? { [H_RESPONSE]: out.responseHeader } : {});
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request, ctx) {
  const { handle } = await ctx.params;
  if (!isValidHandle(handle)) return json({ error: "invalid handle" }, 400);
  return handleTip(request, handle, null);
}

export async function POST(request, ctx) {
  const { handle } = await ctx.params;
  if (!isValidHandle(handle)) return json({ error: "invalid handle" }, 400);
  let body = null;
  try { body = await request.json(); } catch { body = null; }
  return handleTip(request, handle, body);
}

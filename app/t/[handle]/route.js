// @purpose The tip endpoint. GET/POST /t/:handle runs the x402 flow: no payment
//   header -> 402 challenge (payTo = creator's own wallet); valid PAYMENT-SIGNATURE
//   -> verify + settle through the facilitator, then 200 receipt. Non-custodial:
//   funds go payer -> creator directly; this server never holds keys or money.

import { getCreator, resolveAmountUsd, isValidHandle } from "../../../lib/creators.mjs";
import { buildChallenge, verifyAndSettle } from "../../../lib/x402.mjs";
import { activeNetwork } from "../../../lib/config.mjs";

export const runtime = "nodejs"; // facilitator client + lazy CDP SDK need Node, not Edge
export const dynamic = "force-dynamic";

const H_SIGNATURE = "PAYMENT-SIGNATURE";
const H_REQUIRED = "PAYMENT-REQUIRED";
const H_RESPONSE = "PAYMENT-RESPONSE";

function json(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

async function handleTip(request, handleName, body) {
  const creator = getCreator(handleName);
  if (!creator) return json({ error: "creator not found" }, 404);

  const url = new URL(request.url);
  let amountUsd;
  try {
    amountUsd = resolveAmountUsd(creator, {
      tier: url.searchParams.get("tier"),
      amount: url.searchParams.get("amount"),
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 400);
  }

  const net = activeNetwork();
  const resourceUrl = `${url.origin}/t/${handleName}`;
  const label = creator.display_name ? `@${handleName} (${creator.display_name})` : `@${handleName}`;
  const description = `Tip ${label} $${amountUsd} USDC`;

  const { paymentRequired, header, requirements } = buildChallenge({
    amountUsd,
    payTo: creator.wallet,
    resourceUrl,
    description,
    net,
  });

  const sig = request.headers.get(H_SIGNATURE);
  if (!sig) {
    // Unpaid request -> issue the challenge (body for humans, header for x402 clients).
    return json(paymentRequired, 402, { [H_REQUIRED]: header });
  }

  const result = await verifyAndSettle({ paymentSignatureHeader: sig, requirements, net });
  if (!result.ok) {
    return json(
      { ...paymentRequired, error: `payment ${result.stage} failed: ${result.reason || result.message || "unknown"}` },
      402,
      { [H_REQUIRED]: header },
    );
  }

  // Slice 0: onchain tx is the durable record; structured ledger lands in slice 1.
  const tip = {
    handle: handleName,
    amount_usd: amountUsd,
    payer: result.payer,
    tx_hash: result.txHash,
    network: result.network,
    channel: body ? "http-post" : "http-get",
    message: body?.message ?? null,
    payer_name: body?.name ?? null,
    source_url: body?.url ?? null,
  };
  console.log("[tip settled]", JSON.stringify(tip));

  return json(
    {
      ok: true,
      receipt: { handle: handleName, amount_usd: amountUsd, tx_hash: result.txHash, payer: result.payer, network: result.network },
    },
    200,
    { [H_RESPONSE]: result.responseHeader },
  );
}

export async function GET(request, ctx) {
  const { handle } = await ctx.params; // Next 15: params is async
  if (!isValidHandle(handle)) return json({ error: "invalid handle" }, 400);
  return handleTip(request, handle, null);
}

export async function POST(request, ctx) {
  const { handle } = await ctx.params;
  if (!isValidHandle(handle)) return json({ error: "invalid handle" }, 400);
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return handleTip(request, handle, body);
}

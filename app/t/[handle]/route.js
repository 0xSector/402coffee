// @purpose The tip endpoint. GET/POST /t/:handle runs the x402 flow: no payment header
//   -> 402 challenge (payTo = creator's own wallet); valid PAYMENT-SIGNATURE -> verify +
//   settle through the facilitator, then record the tip idempotently and return a 200
//   receipt. Non-custodial: funds go payer -> creator directly; this server holds no keys
//   or money. The creator + ledger live in Postgres (slice 1); replays are idempotent on
//   the EIP-3009 nonce so re-sending a settled payment returns the original receipt.

import { getCreator, resolveAmountUsd, isValidHandle } from "../../../lib/creators.mjs";
import { buildChallenge, verifyAndSettle, peekPayment } from "../../../lib/x402.mjs";
import { activeNetwork } from "../../../lib/config.mjs";
import { recordTip, findByAuthNonce } from "../../../lib/tips.mjs";
import { notifyTip } from "../../../lib/notify.mjs";

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
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extraHeaders },
  });
}

function receiptFor(handle, amountUsd, result, existing) {
  return {
    ok: true,
    replay: Boolean(existing),
    receipt: {
      handle,
      amount_usd: amountUsd,
      tx_hash: existing ? existing.tx_hash : result.txHash,
      payer: existing ? existing.payer : result.payer,
      network: existing ? existing.network : result.network,
      wall: `/${handle}#wall`,
    },
  };
}

async function handleTip(request, handleName, body) {
  const creator = await getCreator(handleName);
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

  // Idempotency pre-check: if this EIP-3009 nonce already settled, return the original
  // receipt without asking the facilitator to re-settle (it would reject the reused nonce).
  const peek = peekPayment(sig);
  if (peek?.authNonce) {
    const existing = await findByAuthNonce(peek.authNonce);
    if (existing) {
      return json(receiptFor(handleName, amountUsd, null, existing), 200);
    }
  }

  const result = await verifyAndSettle({ paymentSignatureHeader: sig, requirements, net });
  if (!result.ok) {
    return json(
      { ...paymentRequired, error: `payment ${result.stage} failed: ${result.reason || result.message || "unknown"}` },
      402,
      { [H_REQUIRED]: header },
    );
  }

  const channel = body?.channel === "widget" ? "widget" : body?.channel === "mcp" ? "mcp" : "http";
  const { inserted, tip } = await recordTip({
    handle: handleName,
    amount_usd: amountUsd,
    amount_atomic: requirements.amount,
    payer: result.payer,
    tx_hash: result.txHash,
    network: result.network,
    channel,
    auth_nonce: peek?.authNonce ?? null,
    message: typeof body?.message === "string" ? body.message.slice(0, 280) : null,
    payer_name: typeof body?.name === "string" ? body.name.slice(0, 60) : null,
    source_url: typeof body?.url === "string" ? body.url.slice(0, 500) : null,
  });
  console.log("[tip settled]", JSON.stringify({ handle: handleName, amount_usd: amountUsd, tx: result.txHash, inserted }));

  // Fire notifications once, on first write only. Never blocks the receipt.
  if (inserted) notifyTip(creator, tip).catch((e) => console.error("[notify] failed:", e?.message || e));

  return json(receiptFor(handleName, amountUsd, result, inserted ? null : tip), 200, {
    [H_RESPONSE]: result.responseHeader,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request, ctx) {
  const { handle } = await ctx.params; // Next: params is async
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

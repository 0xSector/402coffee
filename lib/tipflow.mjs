// @purpose The shared tip core, so the HTTP endpoint (/t/[handle]) and the MCP tip tool
//   run byte-identical logic: resolve the creator + amount into an x402 challenge, and
//   (given a signed payment) verify+settle+record+notify with replay idempotency. Keeping
//   this in one place is the whole "thin harness" bet — one settlement path, many front
//   doors. Non-custodial throughout: payTo is the creator's wallet; we never hold funds.

import { getCreator, resolveAmountUsd } from "./creators.mjs";
import { buildChallenge, verifyAndSettle, peekPayment } from "./x402.mjs";
import { activeNetwork } from "./config.mjs";
import { recordTip, findByAuthNonce } from "./tips.mjs";
import { notifyTip } from "./notify.mjs";

/**
 * Resolve a handle + {tier, amount} into a full x402 challenge. Returns either
 * { error, status } or { creator, amountUsd, requirements, paymentRequired, header }.
 */
export async function resolveAndChallenge({ handleName, tier, amount, origin, net = activeNetwork() }) {
  const creator = await getCreator(handleName);
  if (!creator) return { error: "creator not found", status: 404 };
  let amountUsd;
  try {
    amountUsd = resolveAmountUsd(creator, { tier, amount });
  } catch (e) {
    return { error: String(e?.message || e), status: 400 };
  }
  const resourceUrl = `${origin}/t/${handleName}`;
  const label = creator.display_name ? `@${handleName} (${creator.display_name})` : `@${handleName}`;
  const description = `Tip ${label} $${amountUsd} USDC`;
  const { paymentRequired, header, requirements } = buildChallenge({ amountUsd, payTo: creator.wallet, resourceUrl, description, net });
  return { creator, amountUsd, requirements, paymentRequired, header };
}

function receipt(handleName, amountUsd, row) {
  return {
    handle: handleName,
    amount_usd: amountUsd,
    tx_hash: row.tx_hash,
    payer: row.payer,
    network: row.network,
    wall: `/${handleName}#wall`,
  };
}

/**
 * Given a signed PAYMENT-SIGNATURE, settle and record the tip. Idempotent: a replayed
 * EIP-3009 nonce returns the original receipt without re-settling. Returns
 * { ok:true, replay, receipt, responseHeader? } or { ok:false, stage, reason, message }.
 */
export async function settleAndRecord({ creator, handleName, amountUsd, requirements, sig, net = activeNetwork(), body = null }) {
  const peek = peekPayment(sig);
  if (peek?.authNonce) {
    const existing = await findByAuthNonce(peek.authNonce);
    if (existing) return { ok: true, replay: true, receipt: receipt(handleName, amountUsd, existing) };
  }

  const result = await verifyAndSettle({ paymentSignatureHeader: sig, requirements, net });
  if (!result.ok) return { ok: false, stage: result.stage, reason: result.reason, message: result.message };

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
  if (inserted) notifyTip(creator, tip).catch((e) => console.error("[notify] failed:", e?.message || e));

  const row = inserted ? { tx_hash: result.txHash, payer: result.payer, network: result.network } : tip;
  return { ok: true, replay: !inserted, receipt: receipt(handleName, amountUsd, row), responseHeader: result.responseHeader };
}

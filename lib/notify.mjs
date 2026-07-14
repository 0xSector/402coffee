// @purpose Tip notifications: webhook + email. Called once per tip on first write (the
//   route guarantees idempotency), so this never double-sends. Both channels are
//   best-effort and fail open — a notification failure must never affect a settled tip.
//   Webhook is fully functional (any creator can set webhook_url); email activates only
//   when an email provider key is present (RESEND_API_KEY), else it no-ops cleanly.

import { createHmac } from "node:crypto";

const WEBHOOK_TIMEOUT_MS = 5000;

function receiptPayload(creator, tip) {
  return {
    type: "tip.settled",
    handle: creator.handle,
    amount_usd: Number(tip.amount_usd),
    payer: tip.payer,
    payer_name: tip.payer_name ?? null,
    message: tip.message ?? null,
    source_url: tip.source_url ?? null,
    channel: tip.channel,
    network: tip.network,
    tx_hash: tip.tx_hash,
    settled_at: tip.settled_at ?? tip.created_at ?? null,
  };
}

/** POST the tip to the creator's webhook, HMAC-signed so they can verify authenticity. */
async function fireWebhook(creator, tip) {
  if (!creator.webhook_url) return;
  const body = JSON.stringify(receiptPayload(creator, tip));
  const secret = process.env.WEBHOOK_SIGNING_SECRET || process.env.SIWE_SECRET || "402coffee";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(creator.webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-402coffee-signature": `sha256=${sig}` },
      body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Email the creator via Resend if configured. No-op (logs) when no provider key is set. */
async function fireEmail(creator, tip) {
  if (!creator.email) return;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_EMAIL_FROM || "402 Coffee <tips@402coffee.com>";
  if (!key) {
    console.log(`[notify] email skipped (no RESEND_API_KEY) for @${creator.handle} -> ${creator.email}`);
    return;
  }
  const p = receiptPayload(creator, tip);
  const subject = `☕ New $${p.amount_usd} tip on @${creator.handle}`;
  const lines = [
    `You got a $${p.amount_usd} USDC tip.`,
    p.payer_name ? `From: ${p.payer_name} (${p.payer})` : `From: ${p.payer}`,
    p.message ? `Message: ${p.message}` : null,
    p.source_url ? `On: ${p.source_url}` : null,
    `Channel: ${p.channel}`,
    `Tx: https://basescan.org/tx/${p.tx_hash}`,
  ].filter(Boolean);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: creator.email, subject, text: lines.join("\n") }),
  });
}

/** Fire both channels; isolate failures so one bad sink can't take down the other. */
export async function notifyTip(creator, tip) {
  const results = await Promise.allSettled([fireWebhook(creator, tip), fireEmail(creator, tip)]);
  for (const r of results) {
    if (r.status === "rejected") console.error("[notify] channel error:", r.reason?.message || r.reason);
  }
}

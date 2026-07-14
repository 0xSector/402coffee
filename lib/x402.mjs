// @purpose Thin x402 v2 core: build a 402 challenge for a tip, and verify+settle
//   an incoming payment through a facilitator. This is the churn-exposed heart of
//   the product, kept small on purpose (thin harness, fat config). Built against
//   @x402/core@2.18.0 (protocol v2), verified 2026-07-13.
//
//   v2 protocol notes (differ from x402 v1 / the original plan):
//   - Headers: PAYMENT-REQUIRED (402 challenge), PAYMENT-SIGNATURE (payer -> us),
//     PAYMENT-RESPONSE (settlement receipt). All base64 JSON via the codecs below.
//   - PaymentRequirements = { scheme, network(caip2), asset, amount(atomic string),
//     payTo, maxTimeoutSeconds, extra:{name,version} }. Note: `amount`, not v1's
//     `maxAmountRequired`; no per-requirement description/resource.
//   - Human-readable description lives on PaymentRequired.resource.description.
//   - SettleResponse.transaction holds the tx hash.

import {
  HTTPFacilitatorClient,
  encodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";

import { activeNetwork, usdToAtomic } from "./config.mjs";

// x402 protocol version advertised in challenges. Validated 2026-07-13: the live
// keyless facilitator advertises version 2 for exact/eip155:84532 (see
// test/core.test.mjs getSupported() output). Overridable via env.
export const X402_VERSION = Number(process.env.X402_VERSION || 2);

/**
 * Build the PaymentRequirements row for a tip of `amountUsd` to `payTo`.
 * @param {{amountUsd: string|number, payTo: string, net?: object, maxTimeoutSeconds?: number}} o
 */
export function buildRequirements({ amountUsd, payTo, net = activeNetwork(), maxTimeoutSeconds = 60 }) {
  return {
    scheme: "exact",
    network: net.caip2,
    asset: net.usdc,
    amount: usdToAtomic(amountUsd),
    payTo,
    maxTimeoutSeconds,
    extra: { name: net.tokenName, version: net.tokenVersion },
  };
}

/**
 * Build a full 402 challenge for a tip: the PaymentRequired body (JSON we return
 * to non-x402 clients) and the base64 PAYMENT-REQUIRED header (for x402 clients).
 * @returns {{ paymentRequired: object, header: string }}
 */
export function buildChallenge({ amountUsd, payTo, resourceUrl, description, net = activeNetwork() }) {
  const requirements = buildRequirements({ amountUsd, payTo, net });
  const paymentRequired = {
    x402Version: X402_VERSION,
    error: "Payment required",
    resource: { url: resourceUrl, description },
    accepts: [requirements],
  };
  return { paymentRequired, header: encodePaymentRequiredHeader(paymentRequired), requirements };
}

/**
 * Build a facilitator client for the given network. Testnet uses the keyless
 * x402.org facilitator; mainnet uses the CDP facilitator, whose auth config
 * (url + createAuthHeaders) comes from @coinbase/x402 reading CDP_API_KEY_ID /
 * CDP_API_KEY_SECRET from the environment. @coinbase/x402 is imported lazily so
 * testnet deployments never load the (heavy) CDP SDK.
 */
export async function facilitatorClient(net = activeNetwork()) {
  if (net.requiresCdpKey) {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    const cfg = createFacilitatorConfig();
    if (!cfg?.createAuthHeaders) {
      throw new Error("CDP facilitator needs auth: set CDP_API_KEY_ID and CDP_API_KEY_SECRET");
    }
    return new HTTPFacilitatorClient(cfg);
  }
  return new HTTPFacilitatorClient({ url: net.facilitatorUrl });
}

/**
 * Verify then settle an incoming payment. `paymentSignatureHeader` is the raw
 * base64 PAYMENT-SIGNATURE header from the payer; `requirements` must be the SAME
 * object we challenged with (the facilitator checks the payload against it).
 *
 * @returns {Promise<{ok:true, txHash, payer, network, settleResponse, responseHeader}
 *                    | {ok:false, stage, reason, message}>}
 */
export async function verifyAndSettle({ paymentSignatureHeader, requirements, net = activeNetwork() }) {
  const client = await facilitatorClient(net);

  let payload;
  try {
    payload = decodePaymentSignatureHeader(paymentSignatureHeader);
  } catch (e) {
    return { ok: false, stage: "decode", reason: "malformed_payment", message: String(e?.message || e) };
  }

  const verify = await client.verify(payload, requirements);
  if (!verify.isValid) {
    return { ok: false, stage: "verify", reason: verify.invalidReason, message: verify.invalidMessage };
  }

  const settle = await client.settle(payload, requirements);
  if (!settle.success) {
    return { ok: false, stage: "settle", reason: settle.errorReason, message: settle.errorMessage };
  }

  return {
    ok: true,
    txHash: settle.transaction,
    payer: settle.payer,
    network: settle.network,
    settleResponse: settle,
    responseHeader: encodePaymentResponseHeader(settle),
  };
}

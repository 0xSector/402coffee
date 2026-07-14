// @purpose Validate the churn-exposed x402 v2 core against the REAL installed SDK:
//   exact USD<->atomic math, header codec round-trips (the part that silently
//   breaks when the protocol moves), and a live keyless-testnet facilitator call.
//   Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
  decodePaymentResponseHeader,
  HTTPFacilitatorClient,
} from "@x402/core/http";

import { usdToAtomic, atomicToUsd, NETWORKS } from "../lib/config.mjs";
import { buildChallenge, buildRequirements } from "../lib/x402.mjs";

test("usdToAtomic is exact (no float drift)", () => {
  assert.equal(usdToAtomic("5"), "5000000");
  assert.equal(usdToAtomic("1"), "1000000");
  assert.equal(usdToAtomic("0.25"), "250000");
  assert.equal(usdToAtomic("1.5"), "1500000");
  assert.equal(usdToAtomic("0.1"), "100000");
  assert.equal(usdToAtomic(5), "5000000");
  assert.equal(usdToAtomic("100"), "100000000");
  assert.throws(() => usdToAtomic("-1"));
  assert.throws(() => usdToAtomic("1.2345678")); // > 6 decimals
  assert.throws(() => usdToAtomic("abc"));
});

test("atomicToUsd inverts usdToAtomic", () => {
  for (const v of ["5", "0.25", "1.5", "0.1", "100"]) {
    const usd = atomicToUsd(usdToAtomic(v));
    assert.equal(Number(usd), Number(v));
  }
});

test("buildRequirements produces a valid v2 PaymentRequirements", () => {
  const net = NETWORKS.testnet;
  const r = buildRequirements({ amountUsd: "5", payTo: "0x1111111111111111111111111111111111111111", net });
  assert.equal(r.scheme, "exact");
  assert.equal(r.network, "eip155:84532");
  assert.equal(r.amount, "5000000"); // atomic, not dollars
  assert.equal(r.asset, net.usdc);
  assert.equal(r.payTo, "0x1111111111111111111111111111111111111111");
  assert.equal(r.maxTimeoutSeconds, 60);
  assert.deepEqual(r.extra, { name: net.tokenName, version: net.tokenVersion });
});

test("PAYMENT-REQUIRED header round-trips through the real SDK codec", () => {
  const { paymentRequired, header } = buildChallenge({
    amountUsd: "5",
    payTo: "0x2222222222222222222222222222222222222222",
    resourceUrl: "https://example.test/t/tim",
    description: "Buy @tim a beer",
    net: NETWORKS.testnet,
  });
  assert.equal(typeof header, "string");
  const decoded = decodePaymentRequiredHeader(header);
  assert.deepEqual(decoded, paymentRequired);
  assert.equal(decoded.resource.description, "Buy @tim a beer");
  assert.equal(decoded.accepts[0].amount, "5000000");
});

test("PAYMENT-SIGNATURE header round-trips (payer payload)", () => {
  const payload = {
    x402Version: 1,
    accepted: buildRequirements({ amountUsd: "1", payTo: "0x3333333333333333333333333333333333333333" }),
    payload: {
      signature: "0xdeadbeef",
      authorization: { from: "0xabc", to: "0xdef", value: "1000000", validAfter: "0", validBefore: "9999999999", nonce: "0x01" },
    },
  };
  const header = encodePaymentSignatureHeader(payload);
  assert.deepEqual(decodePaymentSignatureHeader(header), payload);
});

test("PAYMENT-RESPONSE header round-trips (settlement receipt)", () => {
  const settle = { success: true, transaction: "0xhash", network: "eip155:84532", payer: "0xabc" };
  const header = encodePaymentResponseHeader(settle);
  assert.deepEqual(decodePaymentResponseHeader(header), settle);
});

// Live integration: proves the facilitator client + URL + network are wired and
// tells us which x402Version + kinds the keyless testnet facilitator advertises.
test("live: keyless testnet facilitator advertises exact/eip155:84532", { timeout: 20000 }, async (t) => {
  const client = new HTTPFacilitatorClient({ url: NETWORKS.testnet.facilitatorUrl });
  let supported;
  try {
    supported = await client.getSupported();
  } catch (e) {
    t.skip(`facilitator unreachable: ${e?.message || e}`);
    return;
  }
  console.log("getSupported():", JSON.stringify(supported, null, 2));
  const kinds = supported?.kinds ?? [];
  const match = kinds.find((k) => k.scheme === "exact" && k.network === "eip155:84532");
  assert.ok(match, "expected an 'exact' scheme on eip155:84532");
  console.log("advertised x402Version for exact/base-sepolia:", match.x402Version);
});

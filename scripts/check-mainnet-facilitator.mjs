// @purpose Prove the CDP API key authenticates against the mainnet x402 facilitator
//   WITHOUT moving any money. Calls getSupported() through the authed CDP client and
//   asserts the exact/eip155:8453 kind is present.
//   Run: node --env-file=.env.local scripts/check-mainnet-facilitator.mjs

import { NETWORKS } from "../lib/config.mjs";
import { facilitatorClient } from "../lib/x402.mjs";

const net = NETWORKS.mainnet;

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.error("Missing CDP_API_KEY_ID / CDP_API_KEY_SECRET. Run with: node --env-file=.env.local scripts/check-mainnet-facilitator.mjs");
  process.exit(2);
}

const client = await facilitatorClient(net);
console.log("facilitator url:", client.url);

let supported;
try {
  supported = await client.getSupported();
} catch (e) {
  console.error("FAIL: facilitator call errored (bad key or auth?):", e?.message || e);
  process.exit(1);
}

const kinds = supported?.kinds ?? [];
const match = kinds.find((k) => k.scheme === "exact" && k.network === "eip155:8453");
if (!match) {
  console.error("FAIL: no exact/eip155:8453 kind returned. kinds:", JSON.stringify(kinds));
  process.exit(1);
}

console.log(`OK: CDP key authenticates. exact/eip155:8453 at x402Version=${match.x402Version}`);
console.log("kinds:", kinds.map((k) => `${k.scheme}/${k.network} v${k.x402Version}`).join(", "));

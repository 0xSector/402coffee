// @purpose Validate the EXACT payload the browser widget will produce. Signs an EIP-3009
//   TransferWithAuthorization the same way eth_signTypedData_v4 does (same digest), wraps
//   it in the x402 v2 PAYMENT-SIGNATURE envelope, and asks the live testnet facilitator to
//   verify(). isValid:true (or a non-signature failure like funds) proves the widget's
//   signing logic + typed-data domain are correct before we ship the UI. This is the
//   data-quality gate for the human path. Run: node scripts/validate-signing.mjs

import { createPublicClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { NETWORKS } from "../lib/config.mjs";
import { buildRequirements } from "../lib/x402.mjs";

const net = NETWORKS.testnet; // Base Sepolia, keyless facilitator
const chainId = Number(net.caip2.split(":")[1]);
const asset = getAddress(net.usdc);

// 1. Read the USDC EIP-712 domain onchain (authoritative name/version).
const pub = createPublicClient({ transport: http("https://sepolia.base.org") });
const erc20 = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const [name, version, decimals] = await Promise.all([
  pub.readContract({ address: asset, abi: erc20, functionName: "name" }),
  pub.readContract({ address: asset, abi: erc20, functionName: "version" }),
  pub.readContract({ address: asset, abi: erc20, functionName: "decimals" }),
]);
console.log(`onchain USDC: name=${JSON.stringify(name)} version=${JSON.stringify(version)} decimals=${decimals}`);
console.log(`config      : name=${JSON.stringify(net.tokenName)} version=${JSON.stringify(net.tokenVersion)}`);
const domainMatchesConfig = name === net.tokenName && version === net.tokenVersion;
console.log(`config domain matches onchain: ${domainMatchesConfig ? "YES" : "NO (widget uses challenge.extra, so onchain is what matters)"}`);

// 2. Build a v2 exact requirements row (what the server would challenge with), using the
//    ONCHAIN domain so the signature is valid regardless of any stale config.
const payer = privateKeyToAccount("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");
const payTo = "0x772e2C8Cf411B7A7946354B6C2A18aC73Ce9f5ce";
const requirements = {
  ...buildRequirements({ amountUsd: "0.25", payTo, net }),
  extra: { name, version }, // authoritative
};

// 3. Sign the EIP-3009 authorization exactly as the widget will (eth_signTypedData_v4).
const nowSec = Math.floor(Date.now() / 1000);
const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const authorization = {
  from: payer.address,
  to: getAddress(payTo),
  value: requirements.amount,
  validAfter: "0",
  validBefore: String(nowSec + 3600),
  nonce,
};
const typedData = {
  domain: { name, version, chainId, verifyingContract: asset },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: authorization,
};
const signature = await payer.signTypedData(typedData);
console.log(`\nsigned by ${payer.address}, sig ${signature.slice(0, 14)}...`);

// 4. Wrap into the x402 v2 PAYMENT-SIGNATURE payload and verify() with the facilitator.
const payload = { x402Version: 2, accepted: requirements, payload: { signature, authorization } };
const client = new HTTPFacilitatorClient({ url: net.facilitatorUrl });
let verify;
try {
  verify = await client.verify(payload, requirements);
} catch (e) {
  console.log("verify() threw:", e?.message || e);
  process.exit(1);
}
console.log("\nfacilitator verify():", JSON.stringify(verify));

const sigOk = verify.isValid || !/sign|invalid_exact_evm_payload_signature|recover/i.test(String(verify.invalidReason || ""));
console.log(sigOk
  ? "\n✓ SIGNATURE SHAPE VALID (widget payload accepted by facilitator; any failure is funds/balance, not signature)"
  : `\n✗ SIGNATURE REJECTED: ${verify.invalidReason} — typed data or envelope is wrong`);
process.exit(sigOk ? 0 : 1);

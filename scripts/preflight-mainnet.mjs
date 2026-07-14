// @purpose Pre-real-money checks for a mainnet tip: checksum the payout address and
//   read the Base USDC EIP-712 domain (name/version) onchain, so the payer's
//   EIP-3009 signature matches the token contract on the first try.
//   Run: node scripts/preflight-mainnet.mjs 0x<payoutWallet>

import { createPublicClient, http, getAddress } from "viem";
import { NETWORKS } from "../lib/config.mjs";

const payout = process.argv[2];
if (!payout) {
  console.error("usage: node scripts/preflight-mainnet.mjs 0x<payoutWallet>");
  process.exit(2);
}

// checksum the payout address (throws if invalid)
let checksummed;
try {
  checksummed = getAddress(payout);
} catch (e) {
  console.error("FAIL: invalid payout address:", e?.message || e);
  process.exit(1);
}
console.log("payout (checksummed):", checksummed);

const usdc = getAddress(NETWORKS.mainnet.usdc);
const client = createPublicClient({ transport: http("https://mainnet.base.org") });

const erc20 = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const [name, version, symbol, decimals] = await Promise.all([
  client.readContract({ address: usdc, abi: erc20, functionName: "name" }),
  client.readContract({ address: usdc, abi: erc20, functionName: "version" }),
  client.readContract({ address: usdc, abi: erc20, functionName: "symbol" }),
  client.readContract({ address: usdc, abi: erc20, functionName: "decimals" }),
]);

console.log("Base USDC:", usdc);
console.log("  symbol:", symbol, "| decimals:", decimals);
console.log("  EIP-712 name:", JSON.stringify(name), "| version:", JSON.stringify(version));

const cfgName = NETWORKS.mainnet.tokenName;
const cfgVer = NETWORKS.mainnet.tokenVersion;
const match = name === cfgName && version === cfgVer;
console.log(`config has name=${JSON.stringify(cfgName)} version=${JSON.stringify(cfgVer)} -> ${match ? "MATCH ✓" : "MISMATCH ✗ (update lib/config.mjs)"}`);
if (Number(decimals) !== 6) console.log("WARN: decimals != 6");
process.exit(match ? 0 : 1);

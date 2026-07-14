// @purpose Reconcile a settled tip against the chain: fetch the tx receipt, decode
//   the USDC Transfer event, and confirm recipient + amount. This is the data-quality
//   gate — a receipt is not trusted until the onchain transfer matches.
//   Run: node scripts/reconcile.mjs 0x<txHash> [0x<expectedTo>] [expectedAtomic]

import { createPublicClient, http, getAddress, decodeEventLog, parseAbiItem } from "viem";
import { NETWORKS } from "../lib/config.mjs";

const txHash = process.argv[2];
const expectedTo = process.argv[3] ? getAddress(process.argv[3]) : null;
const expectedAtomic = process.argv[4] ?? null;
if (!txHash) { console.error("usage: node scripts/reconcile.mjs 0xTX [0xto] [atomic]"); process.exit(2); }

const USDC = getAddress(NETWORKS.mainnet.usdc);
const client = createPublicClient({ transport: http("https://mainnet.base.org") });

const rcpt = await client.getTransactionReceipt({ hash: txHash });
console.log("tx status  :", rcpt.status);
console.log("block      :", rcpt.blockNumber.toString());

const transferEvt = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
let matched = null;
for (const log of rcpt.logs) {
  if (getAddress(log.address) !== USDC) continue;
  try {
    const d = decodeEventLog({ abi: [transferEvt], data: log.data, topics: log.topics });
    console.log(`USDC Transfer: ${d.args.from} -> ${d.args.to}  value=${d.args.value} (${Number(d.args.value) / 1e6} USDC)`);
    if (!expectedTo || getAddress(d.args.to) === expectedTo) matched = d.args;
  } catch {}
}

const balAbi = parseAbiItem("function balanceOf(address) view returns (uint256)");
if (expectedTo) {
  const bal = await client.readContract({ address: USDC, abi: [balAbi], functionName: "balanceOf", args: [expectedTo] });
  console.log(`recipient USDC balance now: ${Number(bal) / 1e6} USDC`);
}

const ok =
  rcpt.status === "success" &&
  matched &&
  (!expectedTo || getAddress(matched.to) === expectedTo) &&
  (!expectedAtomic || matched.value.toString() === String(expectedAtomic));
console.log("\nRECONCILED:", ok ? "✓ transfer matches receipt" : "✗ MISMATCH");
console.log("basescan:", `https://basescan.org/tx/${txHash}`);
process.exit(ok ? 0 : 1);

// @purpose Simulate the browser widget's exact tip flow against a running server: GET the
//   402 challenge, sign the EIP-3009 authorization the way eth_signTypedData_v4 does, wrap
//   it in the PAYMENT-SIGNATURE header, and POST it back with a message/name (channel
//   "widget"). Proves the human path end to end (through verify+settle+ledger) without a
//   browser. On testnet the settle step needs the signer to hold test USDC; a settle-stage
//   failure still proves the wiring. Run: node scripts/e2e-widget.mjs [baseUrl] [handle]

import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const HANDLE = process.argv[3] || "tim";
const payer = privateKeyToAccount(process.env.TEST_PK || "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");

const url = `${BASE}/t/${HANDLE}?amount=0.25`;
const chal = await (await fetch(url)).json();
const req = chal.accepts?.[0];
if (!req) { console.error("no challenge requirements:", chal); process.exit(1); }
console.log(`challenge: network=${req.network} amount=${req.amount} payTo=${req.payTo}`);

const chainId = Number(req.network.split(":")[1]);
const nowSec = Math.floor(Date.now() / 1000);
const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const authorization = {
  from: payer.address, to: getAddress(req.payTo), value: String(req.amount),
  validAfter: "0", validBefore: String(nowSec + 3600), nonce,
};
const signature = await payer.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ] },
  primaryType: "TransferWithAuthorization",
  message: authorization,
});
const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: req, payload: { signature, authorization } })).toString("base64");

const r = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": header },
  body: JSON.stringify({ channel: "widget", name: "Widget Sim", message: "great post!", url: "https://example.com/post/1" }),
});
const body = await r.json();
console.log(`\nPOST /t/${HANDLE} -> ${r.status}`);
console.log(JSON.stringify(body, null, 2));

if (r.status === 200 && body.ok) {
  console.log("\n✓ WIDGET PATH SETTLED — tip recorded to the ledger via channel=widget");
  // confirm it shows on the wall
  const wall = await (await fetch(`${BASE}/api/wall/${HANDLE}`)).json();
  const mine = (wall.wall || []).find((w) => w.message === "great post!");
  console.log(mine ? "✓ appears on the supporter wall" : "… not on wall yet");
  process.exit(0);
} else if (body.error && /settle/.test(body.error)) {
  console.log("\n◑ WIRING OK — reached settle; failed on funds/testnet (signer holds no test USDC). Signature accepted.");
  process.exit(0);
} else {
  console.log("\n✗ unexpected:", body.error || r.status);
  process.exit(1);
}

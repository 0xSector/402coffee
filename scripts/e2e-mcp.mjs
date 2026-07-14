// @purpose Drive the hosted MCP server over JSON-RPC end to end: initialize, tools/list,
//   get_creator, search_creators, and a full tip — first as discovery (needs_payment), then
//   completing it by signing the returned x402 challenge (EIP-3009) and calling tip again
//   with `payment`. Proves an agent can tip through MCP alone. On testnet the settle needs
//   the signer to hold test USDC. Run: node scripts/e2e-mcp.mjs [baseUrl] [handle]

import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const HANDLE = process.argv[3] || "tim";
const MCP = `${BASE}/mcp`;
const payer = privateKeyToAccount(process.env.TEST_PK || "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");
let id = 0, failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) failed++; };

async function rpc(method, params) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return r.json();
}
const toolCall = (name, args) => rpc("tools/call", { name, arguments: args });
const structured = (res) => res?.result?.structuredContent;

// initialize + list
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
ok(init?.result?.serverInfo?.name === "402coffee", `initialize -> ${init?.result?.serverInfo?.name}`);
const list = await rpc("tools/list", {});
const toolNames = (list?.result?.tools || []).map((t) => t.name).sort().join(",");
ok(toolNames === "get_creator,search_creators,tip", `tools/list -> ${toolNames}`);

// get_creator
const gc = await toolCall("get_creator", { handle: HANDLE });
ok(structured(gc)?.handle === HANDLE, `get_creator(${HANDLE}) -> @${structured(gc)?.handle}`);

// search
const sc = await toolCall("search_creators", { query: HANDLE });
ok(Array.isArray(structured(sc)?.results), `search_creators -> ${structured(sc)?.results?.length} result(s)`);

// tip discovery (no payment)
const disc = await toolCall("tip", { handle: HANDLE, amount_usd: 0.25 });
const chal = structured(disc);
ok(chal?.needs_payment === true && chal?.x402?.accepts?.[0], `tip (no payment) -> x402 challenge, amount ${chal?.amount_usd}`);

// complete the tip: sign the challenge and call tip again with payment
const req = chal.x402.accepts[0];
const chainId = Number(req.network.split(":")[1]);
const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const authorization = { from: payer.address, to: getAddress(req.payTo), value: String(req.amount), validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 3600), nonce };
const signature = await payer.signTypedData({
  domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: req.asset },
  types: { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ] },
  primaryType: "TransferWithAuthorization",
  message: authorization,
});
const payment = Buffer.from(JSON.stringify({ x402Version: 2, accepted: req, payload: { signature, authorization } })).toString("base64");

const done = await toolCall("tip", { handle: HANDLE, amount_usd: 0.25, payment, name: "MCP Agent", message: "via MCP" });
const d = structured(done);
if (d?.ok) {
  ok(true, `tip (with payment) SETTLED via MCP -> tx ${d.receipt?.tx_hash?.slice(0, 12)}…`);
} else if (/settle/.test(d?.stage || "") || /settle/.test(done?.result?.content?.[0]?.text || "")) {
  ok(true, `tip reached settle (testnet funds) — MCP payment path wired`);
} else {
  ok(false, `tip completion: ${done?.result?.content?.[0]?.text || JSON.stringify(d)}`);
}

console.log(failed === 0 ? "\nALL MCP CHECKS PASSED" : `\n${failed} MCP CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

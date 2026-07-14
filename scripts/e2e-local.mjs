// @purpose Live HTTP smoke test of the slice-1 API against a running dev server. Drives
//   the real signup path a new creator would: nonce -> sign -> POST /api/creators ->
//   read profile -> 402 challenge -> SIWE-gated ledger read. Proves the DoD "a second
//   wallet signs up unassisted" without a browser. Run: node scripts/e2e-local.mjs [baseUrl]

import { privateKeyToAccount } from "viem/accounts";
import { buildSiweMessage } from "../lib/siwe.mjs";

const BASE = process.argv[2] || "http://localhost:3000";
const host = new URL(BASE).host;
const account = privateKeyToAccount("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318");
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) failed++; };

async function siwe(handle) {
  const { nonce } = await (await fetch(`${BASE}/api/nonce`)).json();
  const issuedAt = new Date().toISOString();
  const message = buildSiweMessage({ domain: host, address: account.address, handle, nonce, issuedAt, uri: BASE });
  const signature = await account.signMessage({ message });
  return { nonce, issuedAt, signature };
}

const HANDLE = "e2e" + account.address.slice(2, 6).toLowerCase();

// 1. signup
{
  const { nonce, issuedAt, signature } = await siwe(HANDLE);
  const r = await fetch(`${BASE}/api/creators`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      handle: HANDLE, wallet: account.address, nonce, issuedAt, signature,
      profile: { display_name: "E2E Bot", bio: "smoke test", tiers: [{ key: "coffee", label: "Coffee", usd: 1 }, { key: "beer", label: "Beer", usd: 5 }] },
    }),
  });
  const body = await r.json();
  ok(r.status === 201 || r.status === 200, `signup -> ${r.status} (${body.status})`);
  ok(body.creator?.wallet === account.address, `payout wallet stored = signer`);
}

// 2. reject a forged signup for the same handle from a different wallet
{
  const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000abc");
  const { nonce } = await (await fetch(`${BASE}/api/nonce`)).json();
  const issuedAt = new Date().toISOString();
  const message = buildSiweMessage({ domain: host, address: other.address, handle: HANDLE, nonce, issuedAt, uri: BASE });
  const signature = await other.signMessage({ message });
  const r = await fetch(`${BASE}/api/creators`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: HANDLE, wallet: other.address, nonce, issuedAt, signature }),
  });
  ok(r.status === 403, `hijack attempt rejected -> ${r.status}`);
}

// 3. public profile
{
  const r = await fetch(`${BASE}/api/creators/${HANDLE}`);
  const b = await r.json();
  ok(r.status === 200 && b.handle === HANDLE, `GET profile -> ${r.status}`);
  ok(b.email === undefined && b.has_email === false, `private fields not leaked`);
}

// 4. 402 challenge on the tip endpoint
{
  const r = await fetch(`${BASE}/t/${HANDLE}?amount=2`);
  const hdr = r.headers.get("payment-required");
  const b = await r.json();
  ok(r.status === 402, `GET /t/${HANDLE} -> ${r.status}`);
  ok(Boolean(hdr), `PAYMENT-REQUIRED header present`);
  ok(b.accepts?.[0]?.amount === "2000000", `amount atomic = 2000000 (got ${b.accepts?.[0]?.amount})`);
  ok(b.accepts?.[0]?.payTo === account.address, `payTo = creator wallet`);
}

// 5. SIWE-gated ledger read (empty but authorized)
{
  const { nonce, issuedAt, signature } = await siwe(HANDLE);
  const r = await fetch(`${BASE}/api/creators/${HANDLE}/tips`, {
    headers: { "x-siwe-address": account.address, "x-siwe-nonce": nonce, "x-siwe-issued-at": issuedAt, "x-siwe-signature": signature },
  });
  const b = await r.json();
  ok(r.status === 200, `authorized ledger read -> ${r.status}`);
  ok(Array.isArray(b.tips), `ledger returns tips array`);

  // unauthorized read is rejected
  const r2 = await fetch(`${BASE}/api/creators/${HANDLE}/tips`);
  ok(r2.status === 401, `unauthenticated ledger read rejected -> ${r2.status}`);
}

// 6. wall
{
  const r = await fetch(`${BASE}/api/wall/${HANDLE}`);
  ok(r.status === 200, `GET wall -> ${r.status}`);
}

console.log(failed === 0 ? "\nALL E2E CHECKS PASSED" : `\n${failed} E2E CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

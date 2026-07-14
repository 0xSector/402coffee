// @purpose Slice-1 integration tests against a real Postgres (local Docker in dev, or any
//   DATABASE_URL). Proves the money-adjacent invariants: SIWE signatures gate signup and
//   only the owner can edit a handle; the tip ledger is idempotent on BOTH tx_hash and the
//   EIP-3009 nonce so a replayed payment never double-counts. Skips cleanly if no DB.
//   Run: npm run test:db   (needs Docker Postgres on :5433 via .env.local)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";

import { dbConfigured, query, migrate } from "../lib/db.mjs";
import { issueNonce, checkNonce, buildSiweMessage, verifySignup } from "../lib/siwe.mjs";
import {
  createOrUpdateCreator, getCreator, ownsHandle, resolveAmountUsd,
  sanitiseTiers, isValidHandle,
} from "../lib/creators.mjs";
import { recordTip, findByAuthNonce, listWall, creatorStats } from "../lib/tips.mjs";

const HAVE_DB = dbConfigured();
const skip = HAVE_DB ? false : "no DATABASE_URL (run: npm run test:db)";

// Deterministic test wallets.
const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

const DOMAIN = "402coffee.test";
const URI = "https://402coffee.test";

before(async () => {
  if (!HAVE_DB) return;
  // Clean slate on the dev DB, then migrate + seed.
  await query("DROP TABLE IF EXISTS tips CASCADE");
  await query("DROP TABLE IF EXISTS creators CASCADE");
  await migrate();
  if (!process.env.SIWE_SECRET) process.env.SIWE_SECRET = "test-secret-for-siwe";
});

async function signup(account, handle, profile = {}, now = Date.now()) {
  const nonce = issueNonce(now);
  const issuedAt = new Date(now).toISOString();
  const message = buildSiweMessage({ domain: DOMAIN, address: account.address, handle, nonce, issuedAt, uri: URI });
  const signature = await account.signMessage({ message });
  const auth = await verifySignup({ domain: DOMAIN, address: account.address, handle, nonce, issuedAt, uri: URI, signature }, now);
  if (!auth.ok) return { auth };
  const res = await createOrUpdateCreator({ handle, wallet: auth.address, ...profile });
  return { auth, res };
}

test("nonce HMAC + expiry roundtrip", { skip }, () => {
  const now = 1_000_000;
  const n = issueNonce(now);
  assert.equal(checkNonce(n, now).ok, true);
  assert.equal(checkNonce(n, now + 16 * 60 * 1000).ok, false); // expired
  assert.equal(checkNonce(n.slice(0, -1) + "0", now).ok, false); // tampered mac
  assert.equal(checkNonce("garbage", now).ok, false);
});

test("valid SIWE signature creates a handle; bad signer is rejected", { skip }, async () => {
  const { auth, res } = await signup(alice, "alice", { display_name: "Alice" });
  assert.equal(auth.ok, true);
  assert.equal(auth.address, alice.address);
  assert.equal(res.status, "created");
  assert.equal(res.creator.wallet, alice.address);

  // Wrong nonce -> reject.
  const bad = await verifySignup({
    domain: DOMAIN, address: alice.address, handle: "alice",
    nonce: "forged.9999999999999.deadbeef", issuedAt: new Date().toISOString(),
    uri: URI, signature: "0x00",
  });
  assert.equal(bad.ok, false);
});

test("first-come-first-served: another wallet cannot take or edit a handle", { skip }, async () => {
  await signup(alice, "shared");
  const { res } = await signup(bob, "shared", { display_name: "Bob steals it" });
  assert.equal(res.status, "forbidden");
  const c = await getCreator("shared");
  assert.equal(c.wallet, alice.address); // unchanged
});

test("owner can update; ownsHandle reflects control", { skip }, async () => {
  await signup(alice, "updatable", { bio: "v1" });
  const { res } = await signup(alice, "updatable", { bio: "v2", tiers: [{ key: "tea", label: "Tea", usd: 2 }] });
  assert.equal(res.status, "updated");
  const c = await getCreator("updatable");
  assert.equal(c.bio, "v2");
  assert.equal(c.tiers[0].key, "tea");
  assert.equal(await ownsHandle("updatable", alice.address), true);
  assert.equal(await ownsHandle("updatable", bob.address), false);
});

test("tip ledger is idempotent on tx_hash and auth_nonce", { skip }, async () => {
  await signup(alice, "tipme");
  const base = {
    handle: "tipme", amount_usd: "1", amount_atomic: "1000000",
    payer: bob.address, tx_hash: "0xABC123", auth_nonce: "0xNONCE1", channel: "http", network: "base",
  };
  const first = await recordTip(base);
  assert.equal(first.inserted, true);

  // Same tx_hash (different case) -> no new row.
  const dupTx = await recordTip({ ...base, tx_hash: "0xabc123", auth_nonce: "0xNONCE2" });
  assert.equal(dupTx.inserted, false);

  // Same auth_nonce -> no new row.
  const dupNonce = await recordTip({ ...base, tx_hash: "0xDEF456", auth_nonce: "0xnonce1" });
  assert.equal(dupNonce.inserted, false);

  const found = await findByAuthNonce("0xNONCE1");
  assert.ok(found);

  const stats = await creatorStats("tipme");
  assert.equal(stats.tips, 1);
  assert.equal(stats.usd, 1);
  assert.equal(stats.supporters, 1);

  const wall = await listWall("tipme");
  assert.equal(wall.length, 1);
  assert.equal(wall[0].payer, bob.address);
});

test("pure helpers: handle validation, tiers, amount clamping", { skip: HAVE_DB ? false : undefined }, () => {
  assert.equal(isValidHandle("tim"), true);
  assert.equal(isValidHandle("api"), false); // reserved
  assert.equal(isValidHandle("A"), false); // too short / uppercase
  assert.throws(() => sanitiseTiers([{ key: "x", usd: -1 }]));
  const creator = { tiers: [{ key: "coffee", usd: 1 }], min_usd: 0.25, max_usd: 100 };
  assert.equal(resolveAmountUsd(creator, { tier: "coffee" }), "1");
  assert.equal(resolveAmountUsd(creator, { amount: "5" }), "5");
  assert.equal(resolveAmountUsd(creator, { amount: "9999" }), "100"); // clamped to max
  assert.equal(resolveAmountUsd(creator, { amount: "0.01" }), "0.25"); // clamped to min
});

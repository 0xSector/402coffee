// @purpose Sign-In With Ethereum for creator signup/update. Proves the signer controls
//   the payout wallet, which kills typo'd / wrong-chain payout addresses (plan §10) and
//   gates who may edit a handle. Two moving parts:
//     1. Stateless nonces: random.expiry.HMAC — no DB round-trip, self-expiring, and
//        tamper-evident, so a serverless instance can issue and later verify one.
//     2. A canonical SIWE (EIP-4361-shaped) message the client and server build the SAME
//        way from {domain, address, handle, nonce, issuedAt}. The server rebuilds it from
//        the claimed fields and checks the signature recovers to `address`; if any field
//        was altered, recovery fails. So the signature is bound to this handle+wallet.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage, getAddress } from "viem";

const NONCE_TTL_MS = 15 * 60 * 1000; // 15 min to sign
const CHAIN_ID = 8453; // Base mainnet — informational in the message

function secret() {
  // Dedicated secret if set; else derive from the CDP secret so prod has real entropy.
  // Never falls back to a constant in a way that would let an attacker forge nonces:
  // if neither is present we throw at issue time.
  const s = process.env.SIWE_SECRET || process.env.CDP_API_KEY_SECRET;
  if (!s) throw new Error("SIWE_SECRET (or CDP_API_KEY_SECRET) must be set to issue nonces");
  return s;
}

function hmac(data) {
  return createHmac("sha256", secret()).update(data).digest("hex").slice(0, 32);
}

/** Issue a stateless nonce: `<rand>.<expiryMs>.<hmac>`. */
export function issueNonce(now = Date.now()) {
  const rand = randomBytes(12).toString("hex");
  const exp = now + NONCE_TTL_MS;
  const body = `${rand}.${exp}`;
  return `${body}.${hmac(body)}`;
}

/** Validate a nonce's HMAC + expiry. Returns {ok} or {ok:false, reason}. */
export function checkNonce(nonce, now = Date.now()) {
  if (typeof nonce !== "string") return { ok: false, reason: "missing_nonce" };
  const parts = nonce.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_nonce" };
  const [rand, exp, mac] = parts;
  const expect = hmac(`${rand}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_nonce_sig" };
  if (!/^\d+$/.test(exp) || Number(exp) < now) return { ok: false, reason: "expired_nonce" };
  return { ok: true };
}

/**
 * Build the canonical message a wallet signs to claim/update `handle`. Client and server
 * MUST produce byte-identical output for the same inputs. `action` is copy only.
 */
export function buildSiweMessage({ domain, address, handle, nonce, issuedAt, uri }) {
  const addr = getAddress(address); // checksummed, canonical
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    addr,
    ``,
    `Claim or update the tip jar @${handle} on 402 Coffee.`,
    ``,
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/**
 * Verify a signup signature. Rebuilds the canonical message from the claimed fields,
 * checks the nonce is valid+unexpired and the issuedAt is fresh, then verifies the
 * signature recovers to `address` (EIP-191 personal_sign; also covers EIP-1271 smart
 * accounts via viem's on-chain fallback when a client is available — here we use the
 * pure EOA path). Returns {ok, address} (checksummed) or {ok:false, reason}.
 */
export async function verifySignup({ domain, address, handle, nonce, issuedAt, uri, signature }, now = Date.now()) {
  const n = checkNonce(nonce, now);
  if (!n.ok) return { ok: false, reason: n.reason };

  const ts = Date.parse(issuedAt);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_issued_at" };
  if (Math.abs(now - ts) > NONCE_TTL_MS) return { ok: false, reason: "stale_issued_at" };

  let addr;
  try {
    addr = getAddress(address);
  } catch {
    return { ok: false, reason: "bad_address" };
  }

  const message = buildSiweMessage({ domain, address: addr, handle, nonce, issuedAt, uri });
  let valid = false;
  try {
    valid = await verifyMessage({ address: addr, message, signature });
  } catch (e) {
    return { ok: false, reason: "verify_error", message: String(e?.message || e) };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  return { ok: true, address: addr };
}

// @purpose Data-quality gate as a library: compare recorded tips against the actual
//   onchain USDC transfer. A receipt is only trusted once the chain agrees on recipient +
//   amount. Used by the nightly cron (app/api/cron/reconcile) and reusable ad hoc. Only
//   runs for mainnet-network tips (testnet rows are skipped). Marks each tip reconciled so
//   the next run skips it; a mismatch is surfaced, never silently swallowed.

import { createPublicClient, http, getAddress, decodeEventLog, parseAbiItem } from "viem";
import { query, ensureMigrated } from "./db.mjs";
import { NETWORKS } from "./config.mjs";

const USDC = getAddress(NETWORKS.mainnet.usdc);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function client() {
  return createPublicClient({ transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
}

/** Reconcile one tip row against its tx. Returns {ok, reason?}. */
export async function reconcileTip(tip, pub = client()) {
  if (tip.network && tip.network !== "base" && tip.network !== "eip155:8453") {
    return { ok: true, reason: "skipped_non_mainnet" };
  }
  let rcpt;
  try {
    rcpt = await pub.getTransactionReceipt({ hash: tip.tx_hash });
  } catch (e) {
    return { ok: false, reason: `receipt_unavailable: ${e?.message || e}` };
  }
  if (rcpt.status !== "success") return { ok: false, reason: "tx_not_success" };

  const to = getAddress(tip.wallet); // creator payout wallet (joined in by reconcilePending)
  let matched = null;
  for (const log of rcpt.logs) {
    if (getAddress(log.address) !== USDC) continue;
    try {
      const d = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
      if (getAddress(d.args.to) === to) matched = d.args;
    } catch { /* not a Transfer */ }
  }
  if (!matched) return { ok: false, reason: "no_matching_usdc_transfer" };
  if (String(matched.value) !== String(tip.amount_atomic)) {
    return { ok: false, reason: `amount_mismatch: chain=${matched.value} ledger=${tip.amount_atomic}` };
  }
  return { ok: true };
}

/**
 * Reconcile un-reconciled mainnet tips. Marks each row and returns a summary. Mismatches
 * are returned (and logged by the caller) — the whole point is that discrepancies alert.
 */
export async function reconcilePending({ limit = 100 } = {}) {
  await ensureMigrated();
  const { rows } = await query(
    `SELECT t.id, t.tx_hash, t.amount_atomic, t.network, c.wallet
       FROM tips t JOIN creators c ON c.handle = t.handle
      WHERE t.reconciled_at IS NULL
      ORDER BY t.id ASC LIMIT $1`,
    [limit],
  );
  const pub = client();
  const mismatches = [];
  let ok = 0, skipped = 0;
  for (const r of rows) {
    const res = await reconcileTip({ ...r, wallet: r.wallet }, pub);
    if (res.reason === "skipped_non_mainnet") { skipped++; continue; } // leave unmarked (testnet dev rows)
    await query("UPDATE tips SET reconciled_at = now(), reconcile_ok = $2 WHERE id = $1", [r.id, res.ok]);
    if (res.ok) ok++; else mismatches.push({ id: r.id, tx_hash: r.tx_hash, reason: res.reason });
  }
  return { checked: rows.length, ok, skipped, mismatches };
}

// @purpose Tip ledger: record a settled tip idempotently, and read it back for the
//   dashboard, supporter wall, per-post attribution, and leaderboard. Idempotency has
//   two anchors (tx_hash and the EIP-3009 auth_nonce) so replaying an X-PAYMENT can
//   never create a duplicate row — it returns the original receipt. Money-quality data:
//   amounts are stored both as USD (display) and atomic (exact, from the challenge).

import { query, ensureMigrated } from "./db.mjs";

/** Look up an existing tip by the EIP-3009 authorization nonce (pre-settle idempotency). */
export async function findByAuthNonce(authNonce) {
  if (!authNonce) return null;
  await ensureMigrated();
  const { rows } = await query("SELECT * FROM tips WHERE lower(auth_nonce) = lower($1)", [authNonce]);
  return rows[0] ?? null;
}

/** Look up an existing tip by settlement tx hash. */
export async function findByTxHash(txHash) {
  if (!txHash) return null;
  await ensureMigrated();
  const { rows } = await query("SELECT * FROM tips WHERE lower(tx_hash) = lower($1)", [txHash]);
  return rows[0] ?? null;
}

/**
 * Insert a settled tip. Idempotent on tx_hash AND auth_nonce: a conflict returns the
 * existing row with inserted:false, so callers can treat first-write and replay the same.
 * @returns {Promise<{inserted:boolean, tip:object}>}
 */
export async function recordTip(t) {
  await ensureMigrated();
  const { rows } = await query(
    `INSERT INTO tips (handle, amount_usd, amount_atomic, payer, message, payer_name,
                       source_url, channel, network, tx_hash, auth_nonce)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      t.handle, t.amount_usd, t.amount_atomic, t.payer, t.message ?? null, t.payer_name ?? null,
      t.source_url ?? null, t.channel ?? "http", t.network ?? "base", t.tx_hash, t.auth_nonce ?? null,
    ],
  );
  if (rows.length > 0) return { inserted: true, tip: rows[0] };
  // Conflict: return whichever anchor matched.
  const existing = (await findByTxHash(t.tx_hash)) || (await findByAuthNonce(t.auth_nonce));
  return { inserted: false, tip: existing };
}

/** Full ledger for a creator (dashboard). Newest first. */
export async function listTips(handle, { limit = 500 } = {}) {
  await ensureMigrated();
  const { rows } = await query(
    "SELECT * FROM tips WHERE handle = $1 ORDER BY created_at DESC LIMIT $2",
    [handle, limit],
  );
  return rows;
}

/** Public supporter wall: non-hidden tips, redacted to what's safe to show. */
export async function listWall(handle, { limit = 100 } = {}) {
  await ensureMigrated();
  const { rows } = await query(
    `SELECT amount_usd, payer, payer_name, message, source_url, channel, tx_hash, created_at
       FROM tips WHERE handle = $1 AND hidden = false
       ORDER BY created_at DESC LIMIT $2`,
    [handle, limit],
  );
  return rows.map((r) => ({
    amount_usd: Number(r.amount_usd),
    payer: r.payer,
    payer_name: r.payer_name,
    message: r.message,
    source_url: r.source_url,
    channel: r.channel,
    tx_hash: r.tx_hash,
    created_at: r.created_at,
  }));
}

/** Aggregate totals + per-post (source_url) attribution for the dashboard. */
export async function creatorStats(handle) {
  await ensureMigrated();
  const totals = await query(
    `SELECT count(*)::int AS tips, coalesce(sum(amount_usd),0) AS usd,
            count(DISTINCT payer)::int AS supporters
       FROM tips WHERE handle = $1`,
    [handle],
  );
  const byUrl = await query(
    `SELECT coalesce(source_url,'(direct)') AS source_url, count(*)::int AS tips,
            coalesce(sum(amount_usd),0) AS usd
       FROM tips WHERE handle = $1
       GROUP BY 1 ORDER BY usd DESC LIMIT 25`,
    [handle],
  );
  const byChannel = await query(
    `SELECT channel, count(*)::int AS tips, coalesce(sum(amount_usd),0) AS usd
       FROM tips WHERE handle = $1 GROUP BY 1 ORDER BY usd DESC`,
    [handle],
  );
  const t = totals.rows[0];
  return {
    tips: t.tips,
    usd: Number(t.usd),
    supporters: t.supporters,
    by_source: byUrl.rows.map((r) => ({ source_url: r.source_url, tips: r.tips, usd: Number(r.usd) })),
    by_channel: byChannel.rows.map((r) => ({ channel: r.channel, tips: r.tips, usd: Number(r.usd) })),
  };
}

/** Site-wide leaderboard (slice 5 fast-follow, but cheap and useful now). */
export async function leaderboard({ limit = 20 } = {}) {
  await ensureMigrated();
  const { rows } = await query(
    `SELECT t.handle, c.display_name, count(*)::int AS tips,
            coalesce(sum(t.amount_usd),0) AS usd, count(DISTINCT t.payer)::int AS supporters
       FROM tips t JOIN creators c ON c.handle = t.handle
       WHERE t.hidden = false
       GROUP BY t.handle, c.display_name
       ORDER BY usd DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    handle: r.handle, display_name: r.display_name, tips: r.tips,
    usd: Number(r.usd), supporters: r.supporters,
  }));
}

/** Creator moderation: hide/unhide a tip from the public wall. Scoped to their handle. */
export async function setHidden(handle, tipId, hidden) {
  await ensureMigrated();
  const { rows } = await query(
    "UPDATE tips SET hidden = $3 WHERE id = $1 AND handle = $2 RETURNING id, hidden",
    [tipId, handle, Boolean(hidden)],
  );
  return rows[0] ?? null;
}

/** Claim un-notified tips for delivery (idempotent notifications). Marks + returns them. */
export async function claimUnnotified({ limit = 50 } = {}) {
  await ensureMigrated();
  const { rows } = await query(
    `UPDATE tips SET notified = true
       WHERE id IN (SELECT id FROM tips WHERE notified = false ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    [limit],
  );
  return rows;
}

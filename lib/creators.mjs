// @purpose Creator store: handle -> payout wallet + profile + tiers. Backed by Postgres
//   (slice 1). Same shape the route/widget/MCP read. The pure helpers (isValidHandle,
//   resolveAmountUsd, sanitiseTiers) stay synchronous and DB-free so they're trivially
//   testable; anything touching the DB is async. Thin harness: no per-creator code, all
//   behaviour is this row's config.

import { getAddress } from "viem";
import { query, ensureMigrated } from "./db.mjs";

export const HANDLE_RE = /^[a-z0-9-]{2,32}$/;

// Handles we never hand out (routes, brand, footguns). First-come-first-served otherwise.
export const RESERVED_HANDLES = new Set([
  "api", "app", "www", "admin", "dashboard", "widget", "t", "c", "wall", "about",
  "terms", "privacy", "docs", "help", "support", "402coffee", "coffee", "static",
  "assets", "public", "favicon", "robots", "sitemap", "well-known", "llms",
  "mcp", "claim", "leaderboard", "search",
]);

const DEFAULT_TIERS = [
  { key: "coffee", label: "Coffee", usd: 1 },
  { key: "beer", label: "Beer", usd: 5 },
];

export function isValidHandle(h) {
  return typeof h === "string" && HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h);
}

/** Coerce a DB row into the public creator shape (numeric strings -> numbers). */
function rowToCreator(r) {
  if (!r) return null;
  return {
    handle: r.handle,
    wallet: r.wallet,
    display_name: r.display_name,
    bio: r.bio,
    avatar_url: r.avatar_url,
    tiers: Array.isArray(r.tiers) ? r.tiers : DEFAULT_TIERS,
    min_usd: Number(r.min_usd),
    max_usd: Number(r.max_usd),
    email: r.email,
    webhook_url: r.webhook_url,
    domain: r.domain,
    domain_verified: r.domain_verified,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** @returns {Promise<object|null>} the creator record, or null if not found. */
export async function getCreator(handle) {
  if (!isValidHandle(handle)) return null;
  await ensureMigrated();
  const { rows } = await query("SELECT * FROM creators WHERE handle = $1", [handle]);
  return rowToCreator(rows[0]);
}

/** Public list (for discovery / .well-known / leaderboard joins). */
export async function listCreators({ limit = 500 } = {}) {
  await ensureMigrated();
  const { rows } = await query("SELECT * FROM creators ORDER BY created_at ASC LIMIT $1", [limit]);
  return rows.map(rowToCreator);
}

/** Search creators by handle / display name / bio (for the MCP search_creators tool). */
export async function searchCreators(q, { limit = 20 } = {}) {
  await ensureMigrated();
  const term = String(q || "").trim();
  if (!term) return [];
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const { rows } = await query(
    `SELECT * FROM creators
      WHERE handle ILIKE $1 OR display_name ILIKE $1 OR bio ILIKE $1
      ORDER BY (handle ILIKE $1) DESC, created_at ASC
      LIMIT $2`,
    [like, limit],
  );
  return rows.map(rowToCreator);
}

/** Validate + normalise a tiers array from user input. Throws on malformed. */
export function sanitiseTiers(tiers) {
  if (tiers == null) return DEFAULT_TIERS;
  if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 8) {
    throw new Error("tiers must be a non-empty array (<=8)");
  }
  const seen = new Set();
  return tiers.map((t) => {
    const key = String(t.key || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{2,16}$/.test(key)) throw new Error(`invalid tier key: ${JSON.stringify(t.key)}`);
    if (seen.has(key)) throw new Error(`duplicate tier key: ${key}`);
    seen.add(key);
    const usd = Number(t.usd);
    if (!Number.isFinite(usd) || usd <= 0 || usd > 10000) throw new Error(`invalid tier usd: ${t.usd}`);
    const label = String(t.label || key).trim().slice(0, 24) || key;
    return { key, label, usd };
  });
}

/**
 * Create a handle (first-come-first-served) or update an existing one. The caller MUST
 * have already verified `wallet` controls the signature (see lib/siwe.mjs). On update,
 * only the current owner wallet may write — enforced here as a WHERE guard so a race
 * can't let two wallets both "own" a handle.
 * @returns {Promise<{status:'created'|'updated'|'forbidden', creator?:object}>}
 */
export async function createOrUpdateCreator({ handle, wallet, display_name, bio, avatar_url, tiers, min_usd, max_usd, email, webhook_url }) {
  if (!isValidHandle(handle)) throw new Error("invalid or reserved handle");
  await ensureMigrated();

  const walletCk = getAddress(wallet); // throws on bad address
  const tiersJson = JSON.stringify(sanitiseTiers(tiers));
  const min = min_usd == null ? 0.25 : Number(min_usd);
  const max = max_usd == null ? 100 : Number(max_usd);
  if (!(min > 0) || !(max >= min) || max > 100000) throw new Error("invalid min/max_usd");
  const dn = display_name == null ? null : String(display_name).slice(0, 60);
  const b = bio == null ? null : String(bio).slice(0, 280);
  const av = avatar_url == null ? null : String(avatar_url).slice(0, 500);
  const em = email == null ? null : String(email).slice(0, 200);
  const wh = webhook_url == null ? null : String(webhook_url).slice(0, 500);

  const existing = await query("SELECT wallet FROM creators WHERE handle = $1", [handle]);
  if (existing.rows.length === 0) {
    const { rows } = await query(
      `INSERT INTO creators (handle, wallet, display_name, bio, avatar_url, tiers, min_usd, max_usd, email, webhook_url)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT (handle) DO NOTHING
       RETURNING *`,
      [handle, walletCk, dn, b, av, tiersJson, min, max, em, wh],
    );
    if (rows.length === 0) return { status: "forbidden" }; // lost the insert race
    return { status: "created", creator: rowToCreator(rows[0]) };
  }

  // Update requires the SIGNER to be the current owner. The signer's wallet IS the
  // payout wallet (auth.address), so a non-owner signature can never reach the write.
  // Payout-wallet rotation (sign with the OLD wallet, name a NEW one) is a separate,
  // deliberate flow — not this endpoint — so an edit can't silently redirect funds.
  const owner = getAddress(existing.rows[0].wallet);
  if (owner !== walletCk) return { status: "forbidden" };
  const { rows } = await query(
    `UPDATE creators
       SET display_name=$2, bio=$3, avatar_url=$4, tiers=$5::jsonb,
           min_usd=$6, max_usd=$7, email=$8, webhook_url=$9, updated_at=now()
     WHERE handle=$1 AND lower(wallet)=lower($10)
     RETURNING *`,
    [handle, dn, b, av, tiersJson, min, max, em, wh, walletCk],
  );
  if (rows.length === 0) return { status: "forbidden" };
  return { status: "updated", creator: rowToCreator(rows[0]) };
}

/** True iff `wallet` currently owns `handle` (for SIWE-gated reads like the dashboard). */
export async function ownsHandle(handle, wallet) {
  if (!isValidHandle(handle)) return false;
  await ensureMigrated();
  let ck;
  try { ck = getAddress(wallet); } catch { return false; }
  const { rows } = await query("SELECT 1 FROM creators WHERE handle=$1 AND lower(wallet)=lower($2)", [handle, ck]);
  return rows.length > 0;
}

/** Resolve a tier key (coffee|beer|...) and/or amount to a clamped USD string. Pure. */
export function resolveAmountUsd(creator, { tier, amount } = {}) {
  const tiers = creator.tiers ?? [];
  if (tier) {
    const t = tiers.find((x) => x.key === tier);
    if (t) return String(t.usd);
  }
  if (amount != null && amount !== "") {
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("invalid amount");
    const min = Number(creator.min_usd ?? 0.25);
    const max = Number(creator.max_usd ?? 100);
    return String(Math.min(Math.max(usd, min), max));
  }
  return String(tiers[0]?.usd ?? creator.min_usd ?? 1);
}

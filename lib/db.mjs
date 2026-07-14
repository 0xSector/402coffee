// @purpose Postgres access + idempotent schema migration. One pooled client, shared
//   across serverless invocations. Works against local Docker Postgres (dev) and Neon
//   (prod) with the SAME `pg` driver — the connection string decides. SSL is inferred
//   from the host so localhost stays plaintext and Neon gets TLS. This is the only
//   file that talks to the driver; everything else goes through query()/tx().

import pg from "pg";

const { Pool } = pg;

// node-postgres returns NUMERIC as string (to avoid float loss). Good for money, but
// we parse it ourselves at the edges. bigint (int8) also comes back as string; we keep
// tip ids as strings, which is fine for JSON.

let _pool = null;

function needsSsl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    // Neon and most managed Postgres require TLS.
    return true;
  } catch {
    return true;
  }
}

/** Lazily create (and memoise) the pool. Throws a clear error if DATABASE_URL is unset. */
export function getPool() {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (needed for the creator/tip store)");
  _pool = new Pool({
    connectionString: url,
    ssl: needsSsl(url) ? { rejectUnauthorized: false } : false,
    max: 5, // serverless: keep it small; Neon's pooler multiplexes anyway
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  _pool.on("error", (err) => console.error("[db] idle client error:", err?.message || err));
  return _pool;
}

/** Run a parameterised query. Returns the pg result (use .rows). */
export function query(text, params) {
  return getPool().query(text, params);
}

/** True if a DATABASE_URL is configured (so callers can degrade gracefully). */
export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS creators (
  handle            text PRIMARY KEY,
  wallet            text NOT NULL,
  display_name      text,
  bio               text,
  avatar_url        text,
  tiers             jsonb NOT NULL DEFAULT '[{"key":"coffee","label":"Coffee","usd":1},{"key":"beer","label":"Beer","usd":5}]',
  min_usd           numeric NOT NULL DEFAULT 0.25,
  max_usd           numeric NOT NULL DEFAULT 100,
  email             text,
  webhook_url       text,
  domain            text,
  domain_verified   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  wallet_changed_at timestamptz
);

CREATE TABLE IF NOT EXISTS tips (
  id            bigserial PRIMARY KEY,
  handle        text NOT NULL REFERENCES creators(handle) ON DELETE CASCADE,
  amount_usd    numeric NOT NULL,
  amount_atomic text NOT NULL,
  payer         text NOT NULL,
  message       text,
  payer_name    text,
  source_url    text,
  channel       text NOT NULL DEFAULT 'http',
  network       text NOT NULL DEFAULT 'base',
  tx_hash       text NOT NULL,
  auth_nonce    text,
  hidden        boolean NOT NULL DEFAULT false,
  notified      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tips_tx_hash_uniq ON tips (lower(tx_hash));
CREATE UNIQUE INDEX IF NOT EXISTS tips_auth_nonce_uniq ON tips (lower(auth_nonce)) WHERE auth_nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS tips_handle_idx ON tips (handle, created_at DESC);
`;

// Bootstrap seed so the slice-0 endpoint (/t/tim) keeps working the instant the DB
// comes online, before anyone signs up via SIWE. ON CONFLICT DO NOTHING = never
// clobbers a real signup. Tim's real payout wallet, proven onchain in slice 0.
const SEED = `
INSERT INTO creators (handle, wallet, display_name, bio)
VALUES ('tim', '0x772e2C8Cf411B7A7946354B6C2A18aC73Ce9f5ce', 'Tim', 'Onchain payments notes.')
ON CONFLICT (handle) DO NOTHING;
`;

let _migrated = false;

/** Create tables + indexes if missing and seed the bootstrap creator. Idempotent. */
export async function migrate({ seed = true } = {}) {
  await query(SCHEMA);
  if (seed) await query(SEED);
  _migrated = true;
}

/**
 * Ensure the schema exists exactly once per process, lazily. Route handlers call this
 * so a fresh serverless instance self-heals without a separate migrate step. The
 * in-process guard keeps it to one round-trip after the first hit.
 */
export async function ensureMigrated() {
  if (_migrated) return;
  await migrate();
}

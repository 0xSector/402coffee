// @purpose Apply the DB schema (idempotent) to whatever DATABASE_URL points at. Safe to
//   run repeatedly; used for local Docker Postgres and to initialise the Neon prod DB.
//   Run: node --env-file=.env.local scripts/migrate.mjs   (or set DATABASE_URL inline)

import { migrate, query, dbConfigured } from "../lib/db.mjs";

if (!dbConfigured()) {
  console.error("DATABASE_URL is not set. Pass --env-file=.env.local or export DATABASE_URL.");
  process.exit(2);
}

const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return "?"; } })();
console.log(`migrating -> ${host}`);
await migrate();

const c = await query("SELECT count(*)::int AS n FROM creators");
const t = await query("SELECT count(*)::int AS n FROM tips");
console.log(`ok: creators=${c.rows[0].n} tips=${t.rows[0].n}`);
process.exit(0);

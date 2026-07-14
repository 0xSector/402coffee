// @purpose Creator lookup. Slice 0/1 uses a JSON file so the whole flow works
//   with zero infra; slice 1 swaps this module's body for Postgres behind the
//   same interface (thin harness). A creator maps a handle -> payout wallet + tiers.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "creators.json");

const HANDLE_RE = /^[a-z0-9-]{2,32}$/;
export function isValidHandle(h) {
  return typeof h === "string" && HANDLE_RE.test(h);
}

/** @returns {Promise<object|null>} the creator record, or null if not found. */
export async function getCreator(handle) {
  if (!isValidHandle(handle)) return null;
  let all;
  try {
    all = JSON.parse(await readFile(DATA, "utf8"));
  } catch {
    return null;
  }
  return all[handle] ?? null;
}

/** Resolve a tier key (coffee|beer|custom) + optional amount to a USD string. */
export function resolveAmountUsd(creator, { tier, amount } = {}) {
  const tiers = creator.tiers ?? [];
  if (tier) {
    const t = tiers.find((x) => x.key === tier);
    if (t) return String(t.usd);
  }
  if (amount != null) {
    const usd = Number(amount);
    const min = Number(creator.min_usd ?? 0.25);
    const max = Number(creator.max_usd ?? 100);
    if (!Number.isFinite(usd)) throw new Error("invalid amount");
    return String(Math.min(Math.max(usd, min), max));
  }
  // default to the first tier
  return String(tiers[0]?.usd ?? creator.min_usd ?? 1);
}

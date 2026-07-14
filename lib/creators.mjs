// @purpose Creator lookup: handle -> payout wallet + tiers. Slice 0 keeps the seed
//   in-module (no fs, no DB) so the whole flow works on serverless with zero infra;
//   slice 1 swaps the body for Postgres behind this same interface (thin harness).

const HANDLE_RE = /^[a-z0-9-]{2,32}$/;

// Seed creators. `wallet` is the payout address tips settle to (payTo), straight
// through — the service never holds it. Replace placeholders before real money.
const CREATORS = {
  tim: {
    handle: "tim",
    wallet: "0x772e2C8Cf411B7A7946354B6C2A18aC73Ce9f5ce",
    display_name: "Tim",
    bio: "Onchain payments notes.",
    tiers: [
      { key: "coffee", label: "Coffee", usd: 1 },
      { key: "beer", label: "Beer", usd: 5 },
    ],
    min_usd: 0.25,
    max_usd: 100,
  },
};

export function isValidHandle(h) {
  return typeof h === "string" && HANDLE_RE.test(h);
}

/** @returns {object|null} the creator record, or null if not found. */
export function getCreator(handle) {
  if (!isValidHandle(handle)) return null;
  return CREATORS[handle] ?? null;
}

/** Resolve a tier key (coffee|beer|...) and/or amount to a clamped USD string. */
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

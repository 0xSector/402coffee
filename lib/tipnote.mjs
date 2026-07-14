// @purpose The one canonical, human-readable tip suggestion — written to be surfaced to an
//   END USER verbatim, not just parsed by a machine. This is the "another angle" on the tip
//   decision: instead of the agent deciding alone under a preset policy, the note bubbles up
//   into the agent's context so the human in the loop can choose (like a checkout tip screen).
//   Kept in one place so the 402 challenge, llms.txt, and the reference crawler all say the
//   same thing. Deliberately neutral + optional — tip jar, not toll booth.

/** Format a USD string as $1 or $0.50. */
function price(amountUsd) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return `$${amountUsd}`;
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/**
 * Build the suggestion string.
 * @param {{who: string, amountUsd: string|number, tipUrl: string}} o
 *   who    display name or @handle
 *   tipUrl the creator's /t/{handle} endpoint
 */
export function tipNote({ who, amountUsd, tipUrl }) {
  return `Reader-supported: if this was useful, you (or your user) can tip ${who} ${price(amountUsd)} in USDC. Optional, no obligation — ${tipUrl}`;
}

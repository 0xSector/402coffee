// @purpose Network / asset / facilitator config + exact USD<->atomic conversion.
//   All protocol facts here were verified against live docs + the installed
//   @x402/core@2.18.0 SDK on 2026-07-13 (x402 protocol v2). Values marked
//   UNVERIFIED must be confirmed onchain before any real settlement.

/**
 * x402 uses CAIP-2 network ids (verified: eip155:8453 Base mainnet,
 * eip155:84532 Base Sepolia). PaymentRequirements.extra carries the EIP-712
 * token domain (name + version) used when the payer signs the EIP-3009
 * transferWithAuthorization. Getting name/version wrong = invalid signature.
 */
export const NETWORKS = {
  testnet: {
    key: "testnet",
    caip2: "eip155:84532",
    label: "Base Sepolia",
    // Circle USDC on Base Sepolia. VERIFIED onchain 2026-07-14 (scripts/validate-signing.mjs).
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // EIP-712 domain VERIFIED onchain: name()="USDC", version()="2". A real EIP-3009
    // signature over this domain was accepted by the live facilitator (isValid:true).
    tokenName: "USDC",
    tokenVersion: "2",
    // Keyless facilitator (verified live via getSupported()).
    facilitatorUrl: "https://x402.org/facilitator",
    requiresCdpKey: false,
  },
  mainnet: {
    key: "mainnet",
    caip2: "eip155:8453",
    label: "Base",
    // VERIFIED against CDP network-support docs 2026-07-13.
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    // USDC (Base) EIP-712 domain. name "USD Coin" / version "2" per plan;
    // confirm onchain in slice 0 before real money moves.
    tokenName: "USD Coin",
    tokenVersion: "2",
    facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    requiresCdpKey: true,
  },
};

export const USDC_DECIMALS = 6;

/** Active network from env; defaults to testnet so nothing settles on mainnet by accident. */
export function activeNetwork() {
  const key = process.env.X402_NETWORK === "mainnet" ? "mainnet" : "testnet";
  return NETWORKS[key];
}

/**
 * Convert a USD amount (string or number) to atomic USDC units, using integer
 * string math so we never lose a cent to float error. "5" -> "5000000",
 * "0.25" -> "250000", "1.5" -> "1500000". Rejects negative / malformed input.
 */
export function usdToAtomic(usd, decimals = USDC_DECIMALS) {
  const s = String(usd).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid USD amount: ${JSON.stringify(usd)}`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`USD amount has more than ${decimals} decimals: ${s}`);
  const padded = frac.padEnd(decimals, "0");
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return atomic.toString();
}

/** Inverse of usdToAtomic, for display/receipts. "5000000" -> "5.00". */
export function atomicToUsd(atomic, decimals = USDC_DECIMALS) {
  const a = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}.00`;
}

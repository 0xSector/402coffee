// @purpose Reference "tip-aware crawler": the agent side of the tip-jar-not-toll-booth model.
//   Given any URL, it (1) fetches the page, (2) DISCOVERS whether a tip is on offer without any
//   content being gated, (3) reads the x402 challenge, (4) DECIDES via a swappable policy, and
//   (5) dry-runs by default or actually settles with --pay. This is what a crawling LLM's
//   runtime would do: notice the `Link: rel="tip"` header a page volunteers and, on its
//   principal's policy, thank the author. Nothing here is forced — discovery + decision only.
//
//   Discovery order (first hit wins): Link/X-Tip response header -> <link rel="tip"> in HTML
//   -> a `Tip:` line in the origin's /llms.txt.
//
//   Usage:
//     node scripts/tip-crawl.mjs <url> [--tier tokens] [--amount 0.5] [--max-usd 1] [--pay]
//   --pay signs an EIP-3009 authorization with TIP_CRAWLER_PRIVATE_KEY and settles real USDC;
//   without it the crawler stops at the decision and prints what it WOULD tip.

import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { atomicToUsd } from "../lib/config.mjs";

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const DO_PAY = argv.includes("--pay");
const TIER = flag("tier", "tokens");        // agents tip in the tokens tier by default
const AMOUNT = flag("amount", null);         // explicit USD overrides the tier
const MAX_USD = Number(flag("max-usd", "1")); // reference budget cap for the policy

if (!url) {
  console.error("usage: node scripts/tip-crawl.mjs <url> [--tier tokens] [--amount 0.5] [--max-usd 1] [--pay]");
  process.exit(2);
}

const log = (...a) => console.log(...a);

// ---- 1. crawl the page (content is NOT gated) ----------------------------
log(`\n① crawl  ${url}`);
const page = await fetch(url, { headers: { "user-agent": "tip-crawl/1.0 (+402coffee reference)" } });
log(`   ${page.status} ${page.headers.get("content-type") || ""}`);

// ---- 2. discover the tip affordance --------------------------------------
function fromLinkHeader(h) {
  if (!h) return null;
  // RFC 8288: <uri>; rel="tip" (may be one of several comma-separated links)
  for (const part of h.split(/,(?=\s*<)/)) {
    const m = part.match(/<([^>]+)>/);
    if (m && /rel\s*=\s*"?tip"?/i.test(part)) return m[1].trim();
  }
  return null;
}

let tipUrl = fromLinkHeader(page.headers.get("link")) || page.headers.get("x-tip");
let via = tipUrl ? (page.headers.get("x-tip") && !fromLinkHeader(page.headers.get("link")) ? "X-Tip header" : "Link: rel=tip header") : null;

const html = await page.text().catch(() => "");
if (!tipUrl) {
  const m = html.match(/<link[^>]+rel=["']?tip["']?[^>]*>/i);
  const href = m && m[0].match(/href=["']([^"']+)["']/i);
  if (href) { tipUrl = href[1]; via = "<link rel=tip> in HTML"; }
}
if (!tipUrl) {
  try {
    const origin = new URL(url).origin;
    const llms = await (await fetch(`${origin}/llms.txt`)).text();
    const m = llms.match(/^\s*Tip:\s*(\S+)/im);
    if (m) { tipUrl = m[1]; via = "Tip: line in /llms.txt"; }
  } catch { /* no llms.txt */ }
}

if (!tipUrl) {
  log(`\n②  no tip affordance found — this page isn't tip-enabled. Nothing to do.`);
  process.exit(0);
}
if (tipUrl.startsWith("/")) tipUrl = new URL(tipUrl, url).toString();
log(`\n②  tip on offer  ${tipUrl}\n   (discovered via ${via})`);

// ---- 3. read the x402 challenge (still no payment) -----------------------
const challengeUrl = new URL(tipUrl);
if (AMOUNT) challengeUrl.searchParams.set("amount", String(AMOUNT));
else challengeUrl.searchParams.set("tier", TIER);

const chalRes = await fetch(challengeUrl, { headers: { accept: "application/json" } });
if (chalRes.status !== 402) {
  log(`\n③  expected a 402 challenge, got ${chalRes.status}. Aborting.`);
  process.exit(1);
}
const challenge = await chalRes.json();
const req = challenge.accepts && challenge.accepts[0];
if (!req) { log("\n③  challenge had no `accepts` requirements. Aborting."); process.exit(1); }
const usd = atomicToUsd(req.amount);
log(`\n③  challenge  ${usd} USDC  ->  ${req.payTo}`);
log(`   scheme=${req.scheme} network=${req.network} asset=${req.asset}`);

// ---- 4. DECIDE (reference policy — a principal swaps this out) ------------
function decideTip({ usdNum }) {
  if (!(usdNum > 0)) return { tip: false, why: "no positive amount" };
  if (usdNum > MAX_USD) return { tip: false, why: `$${usdNum} over budget cap $${MAX_USD}` };
  return { tip: true, why: `useful crawl, $${usdNum} within budget cap $${MAX_USD}` };
}
const decision = decideTip({ usdNum: Number(usd) });
log(`\n④  decision  ${decision.tip ? "TIP" : "SKIP"} — ${decision.why}`);
if (!decision.tip) process.exit(0);

// ---- 5a. dry-run (default) ------------------------------------------------
if (!DO_PAY) {
  log(`\n⑤  dry-run: would tip ${usd} USDC to ${req.payTo}. Re-run with --pay to settle.`);
  process.exit(0);
}

// ---- 5b. pay: sign EIP-3009 and settle (real USDC) -----------------------
const pk = process.env.TIP_CRAWLER_PRIVATE_KEY;
if (!pk) { console.error("\n✗ --pay needs TIP_CRAWLER_PRIVATE_KEY (a funded wallet) in the env."); process.exit(2); }
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const chainId = Number(String(req.network).split(":")[1]);
const nowSec = Math.floor(Date.now() / 1000);
const nonce = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const authorization = {
  from: account.address,
  to: getAddress(req.payTo),
  value: String(req.amount),
  validAfter: "0",
  validBefore: String(nowSec + (req.maxTimeoutSeconds || 600) + 600),
  nonce,
};
const signature = await account.signTypedData({
  domain: { name: req.extra?.name, version: req.extra?.version, chainId, verifyingContract: getAddress(req.asset) },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: authorization,
});
const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: req, payload: { signature, authorization } })).toString("base64");

log(`\n⑤  paying ${usd} USDC as ${account.address} …`);
const settle = await fetch(challengeUrl, {
  method: "POST",
  headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": header },
  body: JSON.stringify({ channel: "tip-crawl", name: "a crawling agent", message: `tip for ${url}`, url }),
});
const out = await settle.json().catch(() => ({}));
if (settle.status !== 200 || !out.ok) {
  console.error(`\n✗ settle failed (${settle.status}): ${out.error || "unknown"}`);
  process.exit(1);
}
log(`\n✓ tipped ${usd} USDC — tx ${out.receipt?.tx_hash || "(pending)"}`);

// @purpose Static SVG "tip in USDC" badge for READMEs (GitHub strips JS, so a badge is the
//   only embed that works there). Shields-style flat badge that links (via the surrounding
//   markdown) to the creator page. Dependency-free, cacheable. GET /:handle/badge.svg
//   -> [ ☕ tip │ USDC ]. This is tip.md's entire product as one of our features.

import { isValidHandle } from "../../../lib/creators.mjs";

export const runtime = "nodejs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(_req, ctx) {
  const { handle } = await ctx.params;
  const left = "☕ tip";
  const right = handle && isValidHandle(handle) ? "USDC" : "402coffee";
  // rough monospace-ish width so the badge doesn't clip
  const lw = 52;
  const rw = 8 + right.length * 7;
  const w = lw + rw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(left)}: ${esc(right)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${rw}" height="20" fill="#f5a623"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${esc(left)}</text>
    <text x="${lw + rw / 2}" y="14" fill="#1a1205" font-weight="bold">${esc(right)}</text>
  </g>
</svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

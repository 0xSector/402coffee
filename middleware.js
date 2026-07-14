// @purpose Advertise the tip jar to crawling agents WITHOUT gating anything. On a creator
//   profile page (/:handle) we return the page normally (200) and attach an advisory
//   `Link: <.../t/handle>; rel="tip"` response header. This is the inverse of a pay-per-crawl
//   toll booth: Cloudflare returns 402 and blocks the bot; we return 200 and *invite* it. An
//   agent that reads the header can follow the link to the x402 challenge and decide, on its
//   own policy, whether to tip. No JS or DOM parsing needed — a plain GET sees it.
//
//   Only emitted for valid, non-reserved handles (isValidHandle) so /claim, /mcp, etc. never
//   get a bogus tip link. Matcher skips _next, api, and any path with a file extension.

import { NextResponse } from "next/server";
import { isValidHandle } from "./lib/handles.mjs";

export function middleware(req) {
  const res = NextResponse.next();
  const handle = req.nextUrl.pathname.slice(1); // strip leading "/"
  if (isValidHandle(handle)) {
    const tip = `${req.nextUrl.origin}/t/${handle}`;
    // title = a human-readable line a harness can surface to its end user. Generic here
    // (edge middleware has no DB); the per-creator amount/name ride in the 402 challenge `note`.
    res.headers.set("Link", `<${tip}>; rel="tip"; title="Optional: tip the author in USDC if this was useful"`);
    res.headers.set("X-Tip", tip); // convenience mirror for crawlers that don't parse Link
  }
  return res;
}

export const config = {
  // Run on top-level paths only: exclude _next, api, and anything with a dot (llms.txt,
  // widget.js, favicon.ico, *.png). Single-segment creator handles have no dot -> matched.
  matcher: ["/((?!_next/|api/|.*\\.).*)"],
};

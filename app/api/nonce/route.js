// @purpose Issue a stateless SIWE nonce for signup/dashboard signing. GET /api/nonce.
//   The nonce is self-contained (random.expiry.HMAC) so no session/DB is needed; the
//   signer embeds it in the message they sign and we verify it on the way back in.

import { issueNonce } from "../../../lib/siwe.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const nonce = issueNonce();
    return Response.json(
      { nonce, issued_at: new Date().toISOString() },
      { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

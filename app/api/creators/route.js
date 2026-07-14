// @purpose Creator signup / update. POST /api/creators with a SIWE proof. The wallet
//   signs a canonical message binding {wallet, handle, nonce}; we verify the signature
//   recovers to the claimed wallet before writing. First-come-first-served on the handle;
//   updates require a signature from the current owner wallet. Non-custodial: the wallet
//   we store is the payTo tips settle to, so proving control of it here is the whole
//   anti-typo / anti-hijack story.

import { verifySignup } from "../../../lib/siwe.mjs";
import { createOrUpdateCreator, isValidHandle } from "../../../lib/creators.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { handle, wallet, nonce, issuedAt, signature, domain, uri, chainId, profile } = body || {};
  if (!isValidHandle(handle)) return json({ error: "invalid or reserved handle" }, 400);
  if (!wallet || !nonce || !issuedAt || !signature) {
    return json({ error: "wallet, nonce, issuedAt and signature are required" }, 400);
  }

  const dom = domain || new URL(request.url).host;
  const u = uri || `${new URL(request.url).protocol}//${dom}`;

  const auth = await verifySignup({ domain: dom, address: wallet, handle, nonce, issuedAt, uri: u, chainId, signature });
  if (!auth.ok) return json({ error: `signature check failed: ${auth.reason}` }, 401);

  try {
    const p = profile || {};
    const res = await createOrUpdateCreator({
      handle,
      wallet: auth.address,
      display_name: p.display_name,
      bio: p.bio,
      avatar_url: p.avatar_url,
      tiers: p.tiers,
      min_usd: p.min_usd,
      max_usd: p.max_usd,
      email: p.email,
      webhook_url: p.webhook_url,
    });
    if (res.status === "forbidden") {
      return json({ error: "handle is owned by another wallet" }, 403);
    }
    return json({ status: res.status, creator: publicView(res.creator) }, res.status === "created" ? 201 : 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 400);
  }
}

// Never leak email/webhook back in the signup response.
function publicView(c) {
  if (!c) return null;
  const { email, webhook_url, ...rest } = c;
  return { ...rest, has_email: Boolean(email), has_webhook: Boolean(webhook_url) };
}

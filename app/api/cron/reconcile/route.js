// @purpose Nightly reconciliation cron. Vercel calls GET /api/cron/reconcile on schedule
//   (see vercel.json). It compares un-reconciled mainnet tips against the onchain USDC
//   transfer and marks each. Any mismatch is returned + logged loudly (data-quality bar:
//   a discrepancy alerts, it is never silent). Secured with CRON_SECRET when set — Vercel
//   sends it as a Bearer token automatically.

import { reconcilePending } from "../../../../lib/reconcile.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await reconcilePending({ limit: 200 });
    if (res.mismatches.length > 0) {
      console.error("[reconcile] MISMATCHES:", JSON.stringify(res.mismatches));
    }
    console.log("[reconcile]", JSON.stringify({ checked: res.checked, ok: res.ok, skipped: res.skipped, mismatches: res.mismatches.length }));
    return Response.json({ ok: true, ...res });
  } catch (e) {
    console.error("[reconcile] failed:", e?.message || e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

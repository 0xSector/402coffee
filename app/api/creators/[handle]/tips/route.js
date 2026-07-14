// @purpose Creator's private tip ledger. GET /api/creators/:handle/tips — SIWE-gated:
//   the caller proves control of the payout wallet with the same signed message used at
//   signup (passed via x-siwe-* headers). Returns JSON, or CSV with ?format=csv for
//   export. This plus creatorStats is the raw material for the dashboard (slice 3).

import { verifySignup } from "../../../../../lib/siwe.mjs";
import { ownsHandle } from "../../../../../lib/creators.mjs";
import { listTips, creatorStats } from "../../../../../lib/tips.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type,x-siwe-address,x-siwe-nonce,x-siwe-issued-at,x-siwe-signature",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function authOwner(request, handle) {
  const address = request.headers.get("x-siwe-address");
  const nonce = request.headers.get("x-siwe-nonce");
  const issuedAt = request.headers.get("x-siwe-issued-at");
  const signature = request.headers.get("x-siwe-signature");
  if (!address || !nonce || !issuedAt || !signature) return { ok: false, reason: "missing_siwe_headers" };
  const dom = new URL(request.url).host;
  const uri = `${new URL(request.url).protocol}//${dom}`;
  const auth = await verifySignup({ domain: dom, address, handle, nonce, issuedAt, uri, signature });
  if (!auth.ok) return { ok: false, reason: auth.reason };
  if (!(await ownsHandle(handle, auth.address))) return { ok: false, reason: "not_owner" };
  return { ok: true, address: auth.address };
}

function toCsv(rows) {
  const cols = ["created_at", "amount_usd", "payer", "payer_name", "message", "source_url", "channel", "network", "tx_hash", "hidden"];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

export async function GET(request, ctx) {
  const { handle } = await ctx.params;
  const auth = await authOwner(request, handle);
  if (!auth.ok) return Response.json({ error: `unauthorized: ${auth.reason}` }, { status: 401, headers: CORS });

  const rows = await listTips(handle, { limit: 1000 });
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "csv") {
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        ...CORS,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tips-${handle}.csv"`,
      },
    });
  }
  const stats = await creatorStats(handle);
  return Response.json({ handle, stats, tips: rows }, { headers: CORS });
}

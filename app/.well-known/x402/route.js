// @purpose Discovery document for x402 crawlers. GET /.well-known/x402. Serves the
//   ecosystem-standard "legacy" shape { version: 1, resources: [<url>...] } that
//   @agentcash/discovery understands (the same library agentcash AND x402scan use to
//   index origins) — a flat list of each creator's tip endpoint. Crawlers then probe each
//   URL for its live 402 challenge to read the payment terms. A richer per-tier index is
//   available at /.well-known/x402/full for humans/agents that want it.

import { listCreators } from "../../../lib/creators.mjs";
import { withCdnCache } from "../../../lib/cdncache.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const origin = new URL(request.url).origin;
  let creators = [];
  let dbOk = true;
  try { creators = await listCreators({ limit: 500 }); } catch { dbOk = false; }

  // One discoverable resource per creator (the default-tier tip endpoint returns a 402).
  const resources = creators.map((c) => `${origin}/t/${c.handle}`);

  return Response.json(
    { version: 1, resources },
    { headers: withCdnCache({ "access-control-allow-origin": "*", "cache-control": "public, max-age=60" }, dbOk) },
  );
}

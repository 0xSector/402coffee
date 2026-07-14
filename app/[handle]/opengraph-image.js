// @purpose Social unfurl image for a creator page. The shareable page IS the growth loop,
//   so a warm OG card (name, handle, "tip in USDC · no gas · no custody") makes every
//   paste in a DM or tweet render as a real invitation. Uses next/og (no external assets).
//   satori rule: every element with >1 child MUST set display — so every div here is flex
//   and text is a single expression.

import { ImageResponse } from "next/og";
import { getCreator } from "../../lib/creators.mjs";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Tip in USDC on 402 Coffee";

export default async function OG({ params }) {
  const { handle } = await params;
  const c = await getCreator(handle).catch(() => null);
  const name = c?.display_name || `@${handle}`;
  const bioRaw = c?.bio || "Send a USDC tip — no gas, no custody, straight to their wallet.";
  const bio = bioRaw.length > 120 ? bioRaw.slice(0, 117) + "…" : bioRaw;

  const col = { display: "flex", flexDirection: "column" };
  return new ImageResponse(
    (
      <div
        style={{
          ...col, width: "100%", height: "100%", justifyContent: "center", padding: "80px",
          background: "linear-gradient(135deg,#1a1205 0%,#3a2a08 55%,#6b4c0f 100%)",
          color: "#fff", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 120, marginBottom: 10 }}>☕</div>
        <div style={{ display: "flex", fontSize: 68, fontWeight: 800, letterSpacing: -1 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 34, color: "#f5a623", marginTop: 6 }}>{`@${handle}`}</div>
        <div style={{ display: "flex", fontSize: 30, color: "#e6dcc8", marginTop: 24, maxWidth: 900, lineHeight: 1.35 }}>{bio}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40, fontSize: 26, color: "#cbb98f" }}>
          <span>402 Coffee</span>
          <span>·</span>
          <span>tip in USDC</span>
          <span>·</span>
          <span>no gas · no custody</span>
        </div>
      </div>
    ),
    { ...size },
  );
}

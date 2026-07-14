// @purpose The warm creator page — the shareable surface that IS the growth loop. SSR so
//   it renders with real content for social unfurls and crawlers. Shows the profile, tiers,
//   a live inline tip widget (the same widget.js anyone embeds), the supporter wall, and an
//   embed generator. Reads the DB directly (server component) — no self-HTTP. Lives at the
//   root so the URL is clean: 402coffee.com/tim.

import { notFound } from "next/navigation";
import { getCreator } from "../../lib/creators.mjs";
import { listWall, creatorStats } from "../../lib/tips.mjs";
import EmbedGenerator from "./EmbedGenerator.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { handle } = await params;
  const c = await getCreator(handle).catch(() => null);
  if (!c) return { title: "Not found · 402 Coffee" };
  const name = c.display_name || `@${handle}`;
  const title = `Tip ${name} · 402 Coffee`;
  const description = c.bio || `Send ${name} a USDC tip — no gas, no custody, straight to their wallet.`;
  return {
    title,
    description,
    openGraph: { title, description, url: `/${handle}`, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const emojiFor = (k) => (k === "coffee" ? "☕" : k === "beer" ? "🍺" : "💛");
const money = (u) => "$" + (Number(u) % 1 === 0 ? Number(u).toFixed(0) : Number(u).toFixed(2));
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };

export default async function CreatorPage({ params }) {
  const { handle } = await params;
  const creator = await getCreator(handle).catch(() => null);
  if (!creator) notFound();
  const [wall, stats] = await Promise.all([
    listWall(handle, { limit: 50 }).catch(() => []),
    creatorStats(handle).catch(() => ({ tips: 0, usd: 0, supporters: 0 })),
  ]);
  const name = creator.display_name || `@${handle}`;

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <section style={S.card}>
          <div style={S.avatar}>{creator.avatar_url ? <img src={creator.avatar_url} alt="" style={S.avatarImg} /> : "☕"}</div>
          <h1 style={S.name}>{name}</h1>
          <div style={S.handle}>@{handle}</div>
          {creator.bio ? <p style={S.bio}>{creator.bio}</p> : null}
          <div style={S.wallet} title="Payout wallet — tips settle here directly">
            <span style={{ opacity: 0.6 }}>pays to</span> <code>{shortAddr(creator.wallet)}</code>
          </div>

          <div style={S.stats}>
            <Stat n={stats.tips} l="tips" />
            <Stat n={money(stats.usd)} l="received" />
            <Stat n={stats.supporters} l="supporters" />
          </div>

          <div style={S.tiers}>
            {creator.tiers.map((t) => (
              <div key={t.key} style={S.tier}>
                <div style={{ fontSize: 26 }}>{emojiFor(t.key)}</div>
                <div style={S.tierLabel}>{t.label || t.key}</div>
                <div style={S.tierPrice}>{money(t.usd)}</div>
              </div>
            ))}
          </div>

          {/* Live tip button — the exact widget anyone can embed, inline here. */}
          <div id="tip" style={{ marginTop: 6 }}>
            <script src="/widget.js" data-handle={handle} data-inline="" data-label="Tip with USDC" async></script>
          </div>
          <div style={S.note}>Humans sign in-browser (no gas). Agents tip over HTTP or MCP.</div>
        </section>

        <section id="wall" style={S.card}>
          <h2 style={S.h2}>Supporters</h2>
          {wall.length === 0 ? (
            <p style={S.empty}>No tips yet. Be the first ☕</p>
          ) : (
            <ul style={S.wall}>
              {wall.map((w, i) => (
                <li key={i} style={S.wallItem}>
                  <div style={S.wallTop}>
                    <span style={S.wallWho}>{w.payer_name || shortAddr(w.payer)}</span>
                    <span style={S.wallAmt}>{money(w.amount_usd)}</span>
                  </div>
                  {w.message ? <div style={S.wallMsg}>{w.message}</div> : null}
                  <div style={S.wallMeta}>
                    {w.channel === "widget" ? "🧑 human" : w.channel === "mcp" ? "🤖 agent (MCP)" : "🤖 agent"} · {when(w.created_at)}
                    {w.tx_hash ? <> · <a style={S.link} href={`https://basescan.org/tx/${w.tx_hash}`} target="_blank" rel="noreferrer">tx</a></> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={S.card}>
          <h2 style={S.h2}>Add this to your site</h2>
          <EmbedGenerator handle={handle} />
        </section>

        <footer style={S.footer}>
          <a style={S.link} href="/">402 Coffee</a> · non-custodial x402 tip jars · <a style={S.link} href={`/t/${handle}`}>raw endpoint</a>
        </footer>
      </div>
    </main>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{n}</div>
      <div style={{ fontSize: 12, color: "#8a8f98" }}>{l}</div>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f2ede4)", padding: "40px 16px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: "#1a1a1a" },
  wrap: { maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  card: { background: "#fff", borderRadius: 20, padding: 26, boxShadow: "0 4px 24px rgba(20,18,12,.07)", border: "1px solid #eee7db" },
  avatar: { width: 72, height: 72, borderRadius: "50%", background: "#f5a62322", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 10px", overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  name: { fontSize: 24, fontWeight: 700, textAlign: "center", margin: "0 0 2px" },
  handle: { textAlign: "center", color: "#8a8f98", fontSize: 14, marginBottom: 10 },
  bio: { textAlign: "center", color: "#555", fontSize: 14, margin: "0 0 12px", lineHeight: 1.5 },
  wallet: { textAlign: "center", fontSize: 12, color: "#666", marginBottom: 16 },
  stats: { display: "flex", justifyContent: "space-around", padding: "14px 0", borderTop: "1px solid #f0ece3", borderBottom: "1px solid #f0ece3", marginBottom: 18 },
  tiers: { display: "flex", gap: 10, marginBottom: 16 },
  tier: { flex: 1, border: "1.5px solid #eee7db", borderRadius: 14, padding: "14px 8px", textAlign: "center", background: "#fafafa" },
  tierLabel: { fontSize: 12, color: "#555", marginTop: 4 },
  tierPrice: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  note: { textAlign: "center", fontSize: 12, color: "#9a9fa8", marginTop: 12 },
  h2: { fontSize: 16, fontWeight: 700, margin: "0 0 14px" },
  empty: { color: "#9a9fa8", fontSize: 14, textAlign: "center", padding: "10px 0" },
  wall: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  wallItem: { borderLeft: "3px solid #f5a62355", paddingLeft: 12 },
  wallTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  wallWho: { fontWeight: 600, fontSize: 14 },
  wallAmt: { fontWeight: 700, color: "#1e7d34", fontSize: 14 },
  wallMsg: { fontSize: 14, color: "#444", margin: "3px 0" },
  wallMeta: { fontSize: 11.5, color: "#9a9fa8" },
  link: { color: "#c98a12", textDecoration: "none" },
  footer: { textAlign: "center", fontSize: 12, color: "#9a9fa8", padding: "6px 0 20px" },
};

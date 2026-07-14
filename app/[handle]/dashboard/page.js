// @purpose Creator dashboard. Client component: connect the payout wallet, sign the SIWE
//   message once, and read the private ledger through the SIWE-gated /tips endpoint. Shows
//   totals, per-post (source_url) attribution — the analytics buymeacoffee can't do — the
//   human/agent channel split, the full tip table with CSV export, and a hide toggle for
//   wall moderation. All reads carry the signed x-siwe-* headers.
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

// Must match lib/siwe.mjs buildSiweMessage (address verbatim).
function buildSiweMessage({ domain, address, handle, nonce, issuedAt, uri }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`, address, ``,
    `Claim or update the tip jar @${handle} on 402 Coffee.`, ``,
    `URI: ${uri}`, `Version: 1`, `Chain ID: 8453`, `Nonce: ${nonce}`, `Issued At: ${issuedAt}`,
  ].join("\n");
}

const money = (u) => "$" + (Number(u) % 1 === 0 ? Number(u).toFixed(0) : Number(u).toFixed(2));
const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const when = (t) => { try { return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

export default function Dashboard() {
  const { handle } = useParams();
  const [auth, setAuth] = useState(null); // {address, nonce, issuedAt, signature}
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const headers = (a) => ({
    "x-siwe-address": a.address, "x-siwe-nonce": a.nonce, "x-siwe-issued-at": a.issuedAt, "x-siwe-signature": a.signature,
  });

  const connect = async () => {
    setErr(""); setBusy("Connecting");
    try {
      const eth = window.ethereum;
      if (!eth) throw new Error("No Ethereum wallet found.");
      const [address] = await eth.request({ method: "eth_requestAccounts" });
      const { nonce } = await (await fetch("/api/nonce")).json();
      const issuedAt = new Date().toISOString();
      const message = buildSiweMessage({ domain: location.host, address, handle, nonce, issuedAt, uri: location.origin });
      setBusy("Sign in your wallet");
      const signature = await eth.request({ method: "personal_sign", params: [message, address] });
      const a = { address, nonce, issuedAt, signature };
      setBusy("Loading ledger");
      const r = await fetch(`/api/creators/${handle}/tips`, { headers: headers(a) });
      if (r.status === 401) throw new Error("That wallet doesn't own @" + handle + ".");
      if (!r.ok) throw new Error("Failed to load (" + r.status + ")");
      setData(await r.json());
      setAuth(a);
      setBusy("");
    } catch (e) {
      setBusy("");
      let m = e?.message || String(e);
      if (/User rejected|denied|4001/i.test(m)) m = "Signature cancelled.";
      setErr(m);
    }
  };

  const downloadCsv = async () => {
    const r = await fetch(`/api/creators/${handle}/tips?format=csv`, { headers: headers(auth) });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tips-${handle}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleHide = async (tip) => {
    const r = await fetch(`/api/creators/${handle}/tips`, {
      method: "POST", headers: { "content-type": "application/json", ...headers(auth) },
      body: JSON.stringify({ id: tip.id, hidden: !tip.hidden }),
    });
    if (r.ok) setData((d) => ({ ...d, tips: d.tips.map((t) => (t.id === tip.id ? { ...t, hidden: !t.hidden } : t)) }));
  };

  if (!auth) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <a href={`/${handle}`} style={S.back}>← @{handle}</a>
          <h1 style={S.h1}>Dashboard</h1>
          <p style={S.sub}>Connect the payout wallet for @{handle} and sign once to view your tips, per-post analytics, and export.</p>
          <button onClick={connect} style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy}>{busy ? busy + "…" : "Connect wallet"}</button>
          {err ? <div style={S.err}>{err}</div> : null}
        </div>
      </main>
    );
  }

  const { stats, tips } = data;
  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <div style={S.headRow}>
          <div>
            <a href={`/${handle}`} style={S.back}>← @{handle}</a>
            <h1 style={S.h1}>Dashboard</h1>
          </div>
          <button onClick={downloadCsv} style={S.csvBtn}>⭳ Export CSV</button>
        </div>

        <div style={S.stats}>
          <Stat n={stats.tips} l="tips" />
          <Stat n={money(stats.usd)} l="received" />
          <Stat n={stats.supporters} l="supporters" />
        </div>

        <div style={S.grid}>
          <Panel title="By post">
            {stats.by_source.length === 0 ? <Empty /> : stats.by_source.map((s, i) => (
              <Row key={i} left={s.source_url === "(direct)" ? "(direct)" : s.source_url} right={`${money(s.usd)} · ${s.tips}`} />
            ))}
          </Panel>
          <Panel title="By channel">
            {stats.by_channel.length === 0 ? <Empty /> : stats.by_channel.map((s, i) => (
              <Row key={i} left={s.channel === "widget" ? "🧑 human (widget)" : s.channel === "mcp" ? "🤖 agent (MCP)" : "🤖 agent (http)"} right={`${money(s.usd)} · ${s.tips}`} />
            ))}
          </Panel>
        </div>

        <Panel title={`Tips (${tips.length})`}>
          {tips.length === 0 ? <Empty /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead><tr>{["When", "Amount", "From", "Message", "Channel", "Tx", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {tips.map((t) => (
                    <tr key={t.id} style={{ opacity: t.hidden ? 0.45 : 1 }}>
                      <td style={S.td}>{when(t.created_at)}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: "#1e7d34" }}>{money(t.amount_usd)}</td>
                      <td style={S.td}>{t.payer_name || shortAddr(t.payer)}</td>
                      <td style={S.td}>{t.message || <span style={{ color: "#bbb" }}>—</span>}</td>
                      <td style={S.td}>{t.channel}</td>
                      <td style={S.td}>{t.tx_hash ? <a style={S.link} href={`https://basescan.org/tx/${t.tx_hash}`} target="_blank" rel="noreferrer">{shortAddr(t.tx_hash)}</a> : "—"}</td>
                      <td style={S.td}><button onClick={() => toggleHide(t)} style={S.hideBtn}>{t.hidden ? "unhide" : "hide"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}

function Stat({ n, l }) { return <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontWeight: 800 }}>{n}</div><div style={{ fontSize: 12, color: "#8a8f98" }}>{l}</div></div>; }
function Panel({ title, children }) { return <section style={S.panel}><h2 style={S.h2}>{title}</h2>{children}</section>; }
function Row({ left, right }) { return <div style={S.pRow}><span style={S.pLeft}>{left}</span><span style={S.pRight}>{right}</span></div>; }
function Empty() { return <div style={{ color: "#9a9fa8", fontSize: 13, padding: "6px 0" }}>Nothing yet.</div>; }

const S = {
  page: { minHeight: "100vh", background: "#f7f4ef", padding: "40px 16px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: "#1a1a1a" },
  wrap: { maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  card: { maxWidth: 420, margin: "60px auto", background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 4px 24px rgba(20,18,12,.08)", border: "1px solid #eee7db" },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  back: { fontSize: 13, color: "#c98a12", textDecoration: "none" },
  h1: { fontSize: 26, fontWeight: 800, margin: "6px 0 0" },
  sub: { color: "#666", fontSize: 14, lineHeight: 1.5, margin: "10px 0 18px" },
  btn: { border: 0, borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 700, color: "#1a1205", background: "#f5a623", cursor: "pointer", width: "100%" },
  csvBtn: { border: "1.5px solid #e4d9c2", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600, background: "#fff", cursor: "pointer" },
  err: { color: "#c0392b", fontSize: 13.5, marginTop: 12 },
  stats: { display: "flex", justifyContent: "space-around", background: "#fff", borderRadius: 16, padding: "18px 0", border: "1px solid #eee7db" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  panel: { background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #eee7db" },
  h2: { fontSize: 15, fontWeight: 700, margin: "0 0 12px" },
  pRow: { display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid #f2ede3", fontSize: 13 },
  pLeft: { color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" },
  pRight: { color: "#1a1a1a", fontWeight: 600, whiteSpace: "nowrap" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#8a8f98", fontWeight: 600, padding: "6px 10px", borderBottom: "2px solid #f0ece3", whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f4efe5", verticalAlign: "top" },
  link: { color: "#c98a12", textDecoration: "none" },
  hideBtn: { border: "1px solid #e4d9c2", borderRadius: 7, padding: "3px 8px", fontSize: 12, background: "#fff", cursor: "pointer", color: "#888" },
};

// @purpose Landing page. States the product, shows the two front doors (humans sign,
//   agents call), and drives to /claim. Keeps it one screen — the real warm surface is
//   each creator's page.

export const dynamic = "force-static";

export default function Home() {
  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <div style={{ fontSize: 64 }}>☕</div>
        <h1 style={S.h1}>402 Coffee</h1>
        <p style={S.tag}>Non-custodial tip jars for the agentic web. Paste a wallet, pick a handle, get a live payment endpoint and an embeddable button. Tips settle as USDC straight to your wallet — no custodian, no fee.</p>
        <div style={S.cta}>
          <a href="/claim" style={S.primary}>Claim your handle</a>
          <a href="/tim" style={S.secondary}>See an example</a>
        </div>

        <div style={S.grid}>
          <Card emoji="🧑" title="Humans tip with a signature">
            Your readers click a button, sign once in their wallet, and pay zero gas. No app, no chain-switching drama.
          </Card>
          <Card emoji="🤖" title="Agents tip over HTTP or MCP">
            Every jar is a real x402 endpoint (<code style={S.code}>/t/handle</code>) and an MCP tool. Autonomous agents can thank a creator in one call.
          </Card>
          <Card emoji="🔒" title="Non-custodial by design">
            <code style={S.code}>payTo</code> is your wallet. We compose the payment and a facilitator settles it — we never hold keys or funds.
          </Card>
          <Card emoji="🌱" title="Open source">
            MIT. Self-host it, or use the hosted instance. Built on x402 v2, Base USDC first.
          </Card>
        </div>

        <div style={S.demo}>
          <div style={S.demoLabel}>Try it from a terminal:</div>
          <pre style={S.pre}><code>curl https://402coffee.com/t/tim?amount=1
{"\n"}# → 402 Payment Required (x402 challenge). Pay it with any x402 client.</code></pre>
        </div>

        <footer style={S.footer}>
          <a style={S.link} href="https://github.com/0xSector/402coffee" target="_blank" rel="noreferrer">GitHub</a>
          {" · "}<a style={S.link} href="/.well-known/x402">/.well-known/x402</a>
          {" · "}<a style={S.link} href="/leaderboard">leaderboard</a>
        </footer>
      </div>
    </main>
  );
}

function Card({ emoji, title, children }) {
  return (
    <div style={S.card}>
      <div style={{ fontSize: 26, marginBottom: 6 }}>{emoji}</div>
      <div style={S.cardTitle}>{title}</div>
      <div style={S.cardBody}>{children}</div>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "linear-gradient(180deg,#1a1205,#2a1e08 60%,#0f0b03)", color: "#f4ede0", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", padding: "56px 20px" },
  wrap: { maxWidth: 760, margin: "0 auto", textAlign: "center" },
  h1: { fontSize: 44, fontWeight: 800, margin: "6px 0 10px", letterSpacing: -1 },
  tag: { fontSize: 17, color: "#cbb98f", lineHeight: 1.55, maxWidth: 620, margin: "0 auto 26px" },
  cta: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 44 },
  primary: { background: "#f5a623", color: "#1a1205", fontWeight: 700, padding: "12px 22px", borderRadius: 999, textDecoration: "none", fontSize: 15 },
  secondary: { background: "transparent", color: "#f4ede0", fontWeight: 600, padding: "12px 22px", borderRadius: 999, textDecoration: "none", fontSize: 15, border: "1.5px solid #5a4a22" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, textAlign: "left", marginBottom: 36 },
  card: { background: "#ffffff0a", border: "1px solid #ffffff14", borderRadius: 14, padding: 18 },
  cardTitle: { fontWeight: 700, fontSize: 15, marginBottom: 6 },
  cardBody: { fontSize: 13.5, color: "#c3b491", lineHeight: 1.5 },
  code: { background: "#00000040", padding: "1px 5px", borderRadius: 4, fontSize: 12.5 },
  demo: { textAlign: "left", marginBottom: 30 },
  demoLabel: { fontSize: 13, color: "#9a8b64", marginBottom: 6 },
  pre: { background: "#00000055", border: "1px solid #ffffff14", borderRadius: 10, padding: 14, fontSize: 12.5, overflowX: "auto", color: "#e6dcc8", fontFamily: "'SF Mono',Menlo,Consolas,monospace" },
  footer: { fontSize: 13, color: "#9a8b64" },
  link: { color: "#f5a623", textDecoration: "none" },
};

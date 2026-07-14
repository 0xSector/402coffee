// @purpose Placeholder landing. The real creator pages + embed generator are slice 2.

export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px", lineHeight: 1.55 }}>
      <h1 style={{ fontSize: 34, marginBottom: 8 }}>☕ 402 Coffee</h1>
      <p style={{ color: "#555" }}>
        Non-custodial x402 tip jars for the agentic web. Humans tip with a signature, agents tip over
        HTTP or MCP, and every tip settles as USDC straight to the creator&apos;s wallet.
      </p>
      <p style={{ color: "#555" }}>
        Tip endpoint: <code>/t/&lt;handle&gt;</code> — e.g. <code>/t/tim?amount=1</code>
      </p>
    </main>
  );
}

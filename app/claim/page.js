// @purpose Self-serve signup: claim a handle with your wallet, no email/KYC. Client
//   component — connects an injected wallet, signs the canonical SIWE message (replicated
//   byte-for-byte from lib/siwe.mjs buildSiweMessage), and POSTs to /api/creators. On
//   success it sends you to your new page. This is the "30-second onboarding" the plan
//   promises and what makes the DoD "a second wallet signs up unassisted" true for humans.
"use client";

import { useState } from "react";
import { getAddress } from "viem";

// MUST match lib/siwe.mjs buildSiweMessage exactly (address verbatim).
function buildSiweMessage({ domain, address, handle, nonce, issuedAt, uri }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    ``,
    `Claim or update the tip jar @${handle} on 402 Coffee.`,
    ``,
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: 8453`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export default function Claim() {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [tokens, setTokens] = useState("0.5");
  const [coffee, setCoffee] = useState("1");
  const [beer, setBeer] = useState("5");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setDone(null);
    const h = handle.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(h)) return setErr("Handle must be 2–32 chars: a–z, 0–9, hyphen.");
    const eth = window.ethereum;
    if (!eth) return setErr("No Ethereum wallet found. Install MetaMask or Coinbase Wallet.");

    try {
      setBusy("Connecting wallet");
      const [rawFrom] = await eth.request({ method: "eth_requestAccounts" });
      if (!rawFrom) throw new Error("No account");
      // EIP-4361 requires an EIP-55 checksummed address in the message; some wallets return
      // a lowercase one, which makes the wallet refuse to render the SIWE request.
      const from = getAddress(rawFrom);

      setBusy("Getting nonce");
      const { nonce } = await (await fetch("/api/nonce")).json();
      const issuedAt = new Date().toISOString();
      const domain = window.location.host;
      const uri = window.location.origin;
      const message = buildSiweMessage({ domain, address: from, handle: h, nonce, issuedAt, uri });

      setBusy("Sign in your wallet");
      const signature = await eth.request({ method: "personal_sign", params: [message, rawFrom] });

      setBusy("Creating your jar");
      const tiers = [
        { key: "tokens", label: "Tokens", usd: Number(tokens) || 0.5 },
        { key: "coffee", label: "Coffee", usd: Number(coffee) || 1 },
        { key: "beer", label: "Beer", usd: Number(beer) || 5 },
      ];
      const r = await fetch("/api/creators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: h, wallet: from, nonce, issuedAt, signature,
          profile: { display_name: displayName || null, bio: bio || null, email: email || null, tiers },
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `signup failed (${r.status})`);
      setBusy("");
      setDone(h);
      setTimeout(() => { window.location.href = `/${h}`; }, 1200);
    } catch (e2) {
      setBusy("");
      let m = e2?.message || String(e2);
      if (/User rejected|denied|4001/i.test(m)) m = "Signature cancelled.";
      setErr(m);
    }
  };

  return (
    <main style={S.page}>
      <div style={S.card}>
        <a href="/" style={S.back}>← 402 Coffee</a>
        <h1 style={S.h1}>☕ Claim your tip jar</h1>
        <p style={S.sub}>Paste nothing. Connect your wallet, pick a handle, sign once. Tips settle straight to that wallet — no custody, no fee.</p>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Handle" hint="your URL: 402coffee.com/your-handle">
            <div style={S.handleRow}>
              <span style={S.at}>@</span>
              <input style={{ ...S.input, border: 0, flex: 1 }} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="satoshi" autoCapitalize="none" />
            </div>
          </Field>
          <Field label="Display name (optional)">
            <input style={S.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Satoshi N." maxLength={60} />
          </Field>
          <Field label="Bio (optional)">
            <input style={S.input} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Writing about onchain payments." maxLength={280} />
          </Field>
          <div style={{ display: "flex", gap: 12 }}>
            <Field label="Tokens $" hint="agent tier" style={{ flex: 1 }}>
              <input style={S.input} type="number" min="0.25" step="0.25" value={tokens} onChange={(e) => setTokens(e.target.value)} />
            </Field>
            <Field label="Coffee $" style={{ flex: 1 }}>
              <input style={S.input} type="number" min="0.25" step="0.25" value={coffee} onChange={(e) => setCoffee(e.target.value)} />
            </Field>
            <Field label="Beer $" style={{ flex: 1 }}>
              <input style={S.input} type="number" min="0.25" step="0.25" value={beer} onChange={(e) => setBeer(e.target.value)} />
            </Field>
          </div>
          <Field label="Email for tip alerts (optional)">
            <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" maxLength={200} />
          </Field>
          <button type="submit" style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy}>
            {busy ? busy + "…" : "Connect wallet & claim"}
          </button>
        </form>
        {err ? <div style={S.err}>{err}</div> : null}
        {done ? <div style={S.ok}>✓ @{done} is yours. Redirecting…</div> : null}
        <div style={S.foot}>Signing proves you control the payout wallet. That's the whole signup — no password, no email required.</div>
      </div>
    </main>
  );
}

function Field({ label, hint, children, style }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <span style={S.label}>{label}{hint ? <span style={S.hint}> · {hint}</span> : null}</span>
      {children}
    </label>
  );
}

const S = {
  page: { minHeight: "100vh", background: "linear-gradient(180deg,#faf7f2,#f2ede4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", color: "#1a1a1a" },
  card: { width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 4px 24px rgba(20,18,12,.08)", border: "1px solid #eee7db" },
  back: { fontSize: 13, color: "#c98a12", textDecoration: "none" },
  h1: { fontSize: 24, fontWeight: 800, margin: "12px 0 6px" },
  sub: { color: "#666", fontSize: 14, lineHeight: 1.5, marginBottom: 18 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  hint: { fontWeight: 400, color: "#9a9fa8" },
  input: { border: "1.5px solid #e4e4e7", borderRadius: 10, padding: "10px 12px", fontSize: 14, width: "100%" },
  handleRow: { display: "flex", alignItems: "center", border: "1.5px solid #e4e4e7", borderRadius: 10, paddingLeft: 12 },
  at: { color: "#9a9fa8", fontSize: 15 },
  btn: { border: 0, borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 700, color: "#1a1205", background: "#f5a623", cursor: "pointer", marginTop: 4 },
  err: { color: "#c0392b", fontSize: 13.5, marginTop: 12 },
  ok: { color: "#1e7d34", fontSize: 14, fontWeight: 600, marginTop: 12 },
  foot: { fontSize: 12, color: "#9a9fa8", marginTop: 16, lineHeight: 1.5 },
};

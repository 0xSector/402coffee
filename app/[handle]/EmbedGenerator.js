// @purpose Copy-paste embed generator on the creator page. Client component (needs
//   clipboard + the live origin). Emits the four snippets a creator actually needs: the
//   HTML widget tag, a JSX version, the raw x402 endpoint URL, and the markdown README
//   badge (GitHub can't run JS, so the badge is a static SVG that links to the page).
"use client";

import { useEffect, useState } from "react";

export default function EmbedGenerator({ handle }) {
  const [origin, setOrigin] = useState("https://402coffee.com");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const snippets = [
    {
      label: "HTML (any site)",
      code: `<script src="${origin}/widget.js" data-handle="${handle}" async></script>`,
    },
    {
      label: "React / JSX",
      code: `<script src="${origin}/widget.js" data-handle="${handle}" data-inline async></script>`,
    },
    {
      label: "Markdown badge (README)",
      code: `[![Tip in USDC](${origin}/${handle}/badge.svg)](${origin}/${handle})`,
    },
    {
      label: "Raw x402 endpoint (agents)",
      code: `${origin}/t/${handle}`,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ textAlign: "center" }}>
        <img src={`${origin}/${handle}/badge.svg`} alt="Tip badge preview" style={{ height: 20 }} />
      </div>
      {snippets.map((s) => (
        <Snippet key={s.label} label={s.label} code={s.code} />
      ))}
    </div>
  );
}

function Snippet({ label, code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8a8f98", marginBottom: 4 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <pre style={pre}><code>{code}</code></pre>
        <button onClick={copy} style={btn}>{copied ? "✓ copied" : "copy"}</button>
      </div>
    </div>
  );
}

const pre = {
  background: "#12151b", color: "#e6e9ef", borderRadius: 10, padding: "12px 70px 12px 14px",
  fontSize: 12, overflowX: "auto", margin: 0, fontFamily: "'SF Mono',Menlo,Consolas,monospace", whiteSpace: "pre-wrap", wordBreak: "break-all",
};
const btn = {
  position: "absolute", top: 8, right: 8, border: 0, borderRadius: 7, padding: "5px 10px",
  fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f5a623", color: "#1a1205",
};

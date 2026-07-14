// @purpose Root layout (App Router requires one). Sets site-wide metadata + metadataBase
//   so per-page OG/relative URLs resolve correctly on whatever host we're deployed to.

export const metadata = {
  metadataBase: new URL(process.env.BASE_URL || "https://402coffee.com"),
  title: { default: "402 Coffee — non-custodial x402 tip jars", template: "%s" },
  description: "Non-custodial x402 tip jars for the agentic web. Humans tip with a signature, agents tip over HTTP or MCP, USDC settles straight to the creator's wallet.",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>☕</text></svg>" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}

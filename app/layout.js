// @purpose Root layout (App Router requires one). Minimal shell for slice 0;
//   the warm creator page + widget land in slice 2.

export const metadata = {
  title: "402 Coffee",
  description: "Non-custodial x402 tip jars for the agentic web.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}

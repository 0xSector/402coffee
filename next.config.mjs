// @purpose Next.js config. Keep the .mjs libs external so they aren't mangled by the
//   server bundler, and don't try to bundle the optional CDP SDK into edge output.
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@coinbase/x402", "@x402/core"],
};

export default nextConfig;

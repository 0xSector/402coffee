# ☕ 402 Coffee

**Non-custodial x402 tip jars for the agentic web.** Claim a handle with your wallet, get a
live payment endpoint (`/t/@you`) and an embeddable button. Humans tip from a browser wallet
with a signature (no gas); agents tip over HTTP or MCP; every tip settles as USDC straight to
the creator's wallet. No custodian, no fee.

Live: **https://402coffee.com** · MIT · built on x402 **v2**, Base USDC.

## Why non-custodial

`payTo` is the creator's own wallet. The service composes the payment challenge and asks a
facilitator to verify + settle; it never holds keys or funds. Structurally cannot rug anyone,
and stays out of money-transmitter territory.

## Two front doors, one rail

- **Humans** — an embeddable widget runs the full x402 flow in-browser: the payer signs an
  EIP-3009 `transferWithAuthorization` with MetaMask/Coinbase/Rabby and pays **zero gas**.
- **Agents** — every jar is a real x402 endpoint and an MCP tool:
  `tip("@handle", 1.00, "great post")`.

## Embed (any site)

```html
<script src="https://402coffee.com/widget.js" data-handle="tim" async></script>
```

README badge: `[![Tip in USDC](https://402coffee.com/tim/badge.svg)](https://402coffee.com/tim)`

## Routes

| Path | What |
| --- | --- |
| `GET/POST /t/:handle` | The x402 tip endpoint (dynamic `payTo`, `?amount=` / `?tier=`) |
| `GET /:handle` | Warm creator page (SSR, wall, tiers, embed, OG image) |
| `GET /:handle/dashboard` | SIWE-gated dashboard: ledger, per-post analytics, CSV, moderation |
| `GET /:handle/badge.svg` | README tip badge |
| `POST /api/creators` | SIWE signup / update |
| `GET /api/creators/:handle` | Public profile JSON |
| `GET /api/creators/:handle/tips` | SIWE-gated ledger (`?format=csv`) + `POST` to hide a tip |
| `GET /api/wall/:handle` | Public supporter wall |
| `GET /api/search?q=` · `GET /api/leaderboard` | Discovery |
| `GET /api/nonce` | SIWE nonce |
| `POST /mcp` | Hosted MCP server (`get_creator`, `search_creators`, `tip`) |
| `GET /.well-known/x402` · `GET /llms.txt` | Machine-readable discovery |
| `GET /api/cron/reconcile` | Nightly ledger↔onchain reconciliation (cron) |

## Protocol (verified onchain, x402 v2)

Built on `@x402/core@2.18.0` (protocol **v2**). All facts re-verified against the live SDK /
facilitator / chain — never from memory:

| Item | Value |
| --- | --- |
| Headers | `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` |
| Networks | CAIP-2 `eip155:8453` (Base) · `eip155:84532` (Base Sepolia) |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals |
| Scheme | `exact` (EIP-3009 `TransferWithAuthorization`, payer pays no gas) |
| Amount / tx | `PaymentRequirements.amount` (atomic) · `SettleResponse.transaction` |

## Architecture

- `lib/x402.mjs` — thin x402 v2 core: build a challenge; verify + settle (the churn-exposed part)
- `lib/tipflow.mjs` — the shared settle-and-record core used by both `/t/:handle` and MCP
- `lib/creators.mjs` · `lib/tips.mjs` — Postgres store (creators, idempotent tip ledger)
- `lib/siwe.mjs` — stateless-nonce Sign-In-With-Ethereum
- `lib/notify.mjs` — HMAC-signed webhook + optional email
- `lib/reconcile.mjs` — data-quality gate: ledger vs onchain USDC transfers
- `app/` — Next.js App Router (routes above); `public/widget.js` — the zero-dep widget

## Develop

```bash
npm install
# local Postgres (Docker):
docker run -d --name pg402 -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=dev -e POSTGRES_DB=coffee402 -p 5433:5432 postgres:16-alpine
cp .env.example .env.local     # set SIWE_SECRET + DATABASE_URL (see below)
npm run migrate                # create schema
npm run dev                    # http://localhost:3000

npm test                       # x402 v2 protocol/codec tests (vs real SDK + live facilitator)
npm run test:db                # DB + SIWE + notify + moderation integration tests
node scripts/e2e-local.mjs     # live HTTP: signup, challenge, ledger
node scripts/e2e-widget.mjs    # simulate the browser widget tip flow
node scripts/e2e-mcp.mjs       # drive the MCP server end to end
```

## Environment

See `.env.example`. Production (Vercel) needs: `DATABASE_URL` (Neon), `SIWE_SECRET`,
`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (mainnet facilitator), `X402_NETWORK=mainnet`.
Optional: `CRON_SECRET`, `RESEND_API_KEY`, `BASE_RPC_URL`.

## License

MIT.

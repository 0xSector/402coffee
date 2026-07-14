# 402 Coffee (working name)

Non-custodial **x402 tip jars for the agentic web**. Paste a wallet, pick a handle, get a live payment endpoint (`/t/@you`) and an embeddable button. Humans tip from a browser wallet with a signature (no gas); agents tip over HTTP or MCP; every tip settles as USDC straight to the creator's wallet. No custodian, no fee.

Status: **slice 0 (proof of life)** — core payment module built and validated against the live x402 v2 protocol.

## Why non-custodial

`payTo` is the creator's own wallet. The service composes the payment challenge and asks a facilitator to verify + settle; it never holds keys or funds. Structurally cannot rug anyone, and stays out of money-transmitter territory.

## Protocol (verified 2026-07-13, x402 v2)

Built on `@x402/core@2.18.0` (protocol **v2**). Key facts, all re-verified against live docs / the installed SDK / the live facilitator — never from memory:

| Item | Value |
| --- | --- |
| Headers | `PAYMENT-REQUIRED` (challenge), `PAYMENT-SIGNATURE` (payer), `PAYMENT-RESPONSE` (receipt) |
| Networks | CAIP-2: `eip155:8453` (Base), `eip155:84532` (Base Sepolia) |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals |
| Testnet facilitator | `https://x402.org/facilitator` — keyless |
| Mainnet facilitator | `https://api.cdp.coinbase.com/platform/v2/x402` — needs a CDP API key |
| Amount field | `PaymentRequirements.amount` (atomic units) |
| Tx hash | `SettleResponse.transaction` |

## Layout

- `lib/config.mjs` — networks, assets, exact USD↔atomic math (integer string, no float drift)
- `lib/x402.mjs` — build a 402 challenge; verify + settle a payment (the thin core)
- `lib/creators.mjs` — handle → payout wallet + tiers (JSON now, Postgres in slice 1)
- `test/core.test.mjs` — validates codecs + math against the real SDK + a live facilitator call

## Develop

```bash
npm install @x402/core@2.18.0
npm test        # 7 passing: USD math, header round-trips, live testnet facilitator
```

## License

MIT.

# Deploy: Vercel + Neon Postgres

`pnpm build` passes locally (Next.js 16, every route dynamic). Migrations are idempotent DDL run by the
seed script, not at request time, so run them once against the deployed database.

## 1. Database (Neon)
1. Create a Neon project `kaddu`. Copy the **pooled** connection string (host contains `-pooler`),
   with `?sslmode=require`. The client already uses `prepare: false`, which poolers need.
2. From your machine, migrate + seed the deployed DB (uses your local `seed/` files):
   ```bash
   DATABASE_URL="postgres://…-pooler…/neondb?sslmode=require" pnpm seed
   ```
   This creates the tables, loads `seed/manifest.json` clips and runs the personas. Re-running is safe.
   The persona keys are generated into your local `.env.local` on the first run.

## 2. Vercel
- Import the GitHub repo. **Root Directory: `apps/web`** (keep "include files outside the root" on;
  the workspace packages live in `packages/`). Framework: Next.js. Vercel detects pnpm from the root lockfile.
- Environment variables (Production), from `.env.example`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `SPONSOR_NWC_URL` | sponsor faucet wallet (server only) |
| `SERVER_NOSTR_NSEC` | 64-hex; copy from `.env.local` so attestations keep the same signer |
| `ADMIN_TOKEN` | ≥ 24 random chars |
| `NOSTR_RELAYS` | `wss://relay.damus.io,wss://nos.lol` |
| `NWC_RELAY_ORIGINS` | relay origins of the faucet wallets (`pnpm nwc:probe` prints them); the browser CSP needs these to connect worker wallets |
| `DEMO_MODE` | `1` |
| `AI_MOCK` | `1` without a Gemini key (mock judge); `0` + `GEMINI_API_KEY` + `GEMINI_MODEL` for the real judge |
| `MAX_DAILY_PAYOUT_SATS`, `MAX_CLAIM_SATS` | e.g. `5000`, `1000` |

## 3. Smoke test
- `GET /api/health` → `db: true`, `sponsorWallet: true`, `relays: 2`.
- `/sponsor` → sign in with `ADMIN_TOKEN`; budget meter shows the wallet.
- Phone: `/` → consent → Wolof → correct a clip → `/wallet` → connect `live-worker` → auto-claim.

## Notes
- Rate limits are in-memory per serverless instance (see THREAT_MODEL.md, residual risks).
- Claims can take up to ~45 s when a wallet is slow; `/api/claim` sets `maxDuration = 60`.
- Locally, Kàddu's docker Postgres listens on host port **5433** (5432 is often taken by other apps).

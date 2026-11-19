# Threat model: Kàddu

Kàddu pays speakers small amounts of sats (20–40 per clip) to correct AI transcripts of Wolof, Yorùbá and
Naija Pidgin (the backend also accepts Hausa, which has no seed clips). A sponsor funds payouts from their own
Lightning wallet. The app never holds funds.

## Assets
| Asset | Where it lives | Why it matters |
|---|---|---|
| Sponsor NWC string (`SPONSOR_NWC_URL`) | Server env only | Pays every reward |
| Worker NWC string | Worker's browser IndexedDB only, never sent to the server | Receives payouts |
| Worker Nostr key | Worker's browser IndexedDB (backup shown once) | Signs corrections and claims; it *is* the account |
| Server Nostr key (`SERVER_NOSTR_NSEC`) | Server env only | Signs dataset attestations |
| `ADMIN_TOKEN` | Server env; the browser only holds an HMAC of it in an httpOnly cookie | Sponsor console: upload, pause, resolve disputes, export |
| Voice clips | Postgres `bytea` | Voices are personal data |
| `truth_text` of seed/gold clips | Postgres only, never sent to clients | Leaking it would let farmers pass gold checks |
| Rewards ledger | Postgres (`rewards`, `claims`) | Defines who is owed what |

## Actors
- Honest worker, sponsor (admin), dataset user.
- Attackers: **farmer** (many keys, wants sats for no work), **lazy worker** (pastes the AI draft),
  **colluding group** (3+ keys agreeing on garbage), **prompt injector** (text aimed at the AI judge),
  **thief** (wants someone else's balance), **network attacker / XSS**, **flooder**.

## Trust boundaries
```
worker browser ──(signed Nostr events)──▶ Next.js API ──▶ Postgres (Neon / Supabase / docker)
      │                                      │──▶ Gemini (judge, drafts; text/audio as untrusted data)
      │                                      └──▶ sponsor wallet (NWC over Nostr relays): pay_invoice
      └──(NWC, browser only)──▶ worker's own wallet (make_invoice for claims)
```

## Threats → mitigations
| Threat | Mitigation | Evidence |
|---|---|---|
| Farming with many keys (Sybil) | First 2 clips are gold (qualification); ~25% hidden gold after; payouts need gold accuracy ≥ 0.7; k=3 agreement; 50 accepted/worker/day; app cap `MAX_DAILY_PAYOUT_SATS`; sponsor's NWC budget. Worst case: one day's budget. | `score.test.ts`, `eval/RESULTS.md` §3 |
| Lazy paste-back of the AI draft | "Unchanged" is allowed but only paid through consensus; a wrong draft loses to honest corrections; lazy workers fail gold. | red team #2, `score.test.ts` |
| Collusion (3 keys agree on garbage) | Workers can't choose clips (random assignment); hidden gold; sponsor spot-checks and dispute review. **Residual.** | `assign.ts`, `/sponsor` |
| Stealing someone's balance | A claim is a Nostr event signed by the worker's key whose content is the bolt11; the server pays only the signer's balance. Changing the invoice breaks the signature. | `claim.test.ts` |
| Replay of corrections / claims | `corrections.event_id` UNIQUE (the real defence) + `created_at` within now−6 h…now+5 min; claims: `payment_hash` UNIQUE + ±5 min window; one correction per worker per clip. | `phase1.test.ts`, `payouts.test.ts`, red team #7, #9 |
| Forged corrections | Signature verified on a fresh object (nostr-tools caches verification); the `clip` tag must match the content. | `phase1.test.ts`, red team #8 |
| Double payout on timeout/crash | `@sats/payouts`: reserve → pay → settle; ambiguous failures stay pending; reconcile. `accrue` is idempotent per correction id. | `payouts.test.ts` |
| Stolen sponsor key | Server env only; should be `pay_invoice`-only with budget + expiry in production (boot warning via `checkSponsor`); sponsor can pause payouts instantly. | `sponsor.ts`, `/sponsor` |
| AI sets amounts / pays attackers | Amounts come only from the server price table (`pricing.ts`). The judge schema has no amount or recipient field; zod strips extras; the judge can only flag for rejection. | `judge.test.ts` |
| Prompt injection in transcripts | Transcript wrapped in `<untrusted_content>` with a never-follow rule; `injection_text` flag rejects; judge outage doesn't block (consensus still applies). | `judge.test.ts`, red team #3 |
| Gold answers leaking | `/api/next` returns only id, lang, duration, draft, price, audio URL. Never `truth_text` or `is_gold`. | `phase1.test.ts` |
| Admin takeover | Constant-time token compare; cookie = HMAC(token), httpOnly, SameSite=Strict, Secure on https; login rate-limited (5, then 1 per 20 s). | `sponsor.test.ts` |
| Malicious uploads | Admin only; ≤200 KB, ≤15 s (parsed with music-metadata), MIME allowlist (`audio/ogg`, `audio/webm`, `audio/mpeg`, `audio/mp4`), id regex; served with `nosniff` and the stored MIME. | `sponsor.test.ts` |
| XSS / injected scripts | Per-request nonce CSP from the starter (no inline styles either); exact relay origins only; React escaping; no `dangerouslySetInnerHTML`. | `csp.test.ts` |
| Slow first NWC connection mistaken for a bad string | `connectWallet` retries once with a fresh client (15 s, then 30 s) and closes the stuck one; definitive wallet errors (UNAUTHORIZED, RESTRICTED…) don't retry. The sponsor wallet is cached only after a successful connect. | `connect.test.ts` |
| Licence violation in the dataset | Licence per clip: Yorùbá clips come from CC BY-SA 4.0 audio, so their transcripts are exported and attested as CC BY-SA 4.0; everything else is CC-BY-4.0. Sources and checks recorded in `seed/LICENSES.md`. | `licenseFor()` in `score.ts`, `sponsorOps.ts` |
| Workers misled about AI quality | Simulated placeholder drafts are stored with `draft_model = "simulated"` and the work screen labels them. | `assign.ts`, `/work` |
| Supply chain in the seed pipeline | Audio conversion uses the pinned `ffmpeg-static` binary (no system ffmpeg); downloads are read with HTTP range requests from the dataset hosts only; the scripts run on the builder's machine, never on the server. | `scripts/_seedlib.ts` |
| Flooding | In-memory token buckets keyed by a salted hash of IP + user agent: `/api/next` 30 (1/s), `/api/corrections` 20 (1 per 2 s), `/api/claim` 5 (1 per 10 s), `/api/balance` 30, sponsor login 5, upload 30. Request bodies capped (4 KB JSON). | `lib/http.ts` |
| PII in logs | Allowlisted logger only (`event, id, paymentHash, latencyMs, status, code, count`); eslint bans `console`; a test runs the whole pipeline and checks that no transcript, pubkey, invoice or token reaches the log. | `log-audit.test.ts`, `log.test.ts` |

## Residual risks (accepted)
- **Collusion** by ≥2 of the 3 workers on a clip who all pass gold. Mitigated, not prevented.
- **Rate limits are per instance** (in-memory). On serverless they reset on cold start; the daily caps
  and the sponsor budget are the hard backstop.
- **Pubkeys are public** (`/api/balance` and the export show them). They are pseudonymous: no name,
  phone or email is ever collected.
- **The mock judge** (offline demo) is keyword-based. With a Gemini key the real judge is used.
- **Drafts are simulated** in the demo, so draft-quality numbers say nothing about real ASR yet.
- **The live payout path** was checked end to end on the local stack (`pnpm checkpoint`: 100 sats settled into the
  worker wallet). The deployed Neon + Vercel stack runs the same code but has not been through `pnpm checkpoint --base <url>` yet.
- **Voices** in seed data come from openly licensed datasets (galsenai Wolof, Apache-2.0; OpenSLR SLR86
  Yorùbá, CC BY-SA 4.0) or from the author's own recordings (`seed/LICENSES.md`); voices can still identify a person.

## What we log / never log
- **Log:** event name, correction/clip ids, paymentHash, latencyMs, status, reject code, counts.
- **Never log:** request bodies, IPs, audio, transcripts, pubkeys, invoices, NWC strings, keys, tokens.

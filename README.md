# Kàddu: AI can't understand our languages yet. Get paid in sats to teach it.

> Built for Dakar Bitcoin Hack 2026. MIT licensed. **Demo: test sats, sample data, simulated AI drafts** (see [What's simulated](#constraints--whats-simulated)).

*Kàddu* means "speech" in Wolof. You hear a short voice clip in Wolof, Yorùbá or Naija Pidgin and see the AI's rough
transcript. You fix it. When two other speakers agree with your fix, sats land in your Lightning wallet within seconds.

## Problem & primary user
- **AI is weak on these languages.** On FLEURS-Wolof, ElevenLabs' published benchmark reports Gemini 2.0 Flash at about
  48% WER and Whisper large-v3 at about 97% WER. This is a **vendor benchmark**, not an independent one.
  [elevenlabs.io/speech-to-text/wolof](https://elevenlabs.io/speech-to-text/wolof)
- **Fixing transcripts by hand is slow.** A 2025 RobotsMali study of **Bambara** (Mali, a language with the same
  low-resource problem, not Wolof) found that human-correcting ASR drafts takes about 30 hours of work per hour of audio
  in the lab and about 36 in the field. [arXiv:2510.12781](https://arxiv.org/abs/2510.12781)
- **Voice reaches everyone.** Senegal's adult literacy rate is about 50% (UNESCO UIS, 2023: 50.4%).
  [FRED / UIS series](https://fred.stlouisfed.org/data/SEADTLITRZSSEN)
- Funders of African speech data (labs, NGOs, language-tech companies) need corrected transcripts. Payouts to many small
  contributors in several countries are hard to do with mobile money, which works per country and per provider.
- **Primary users:** bilingual students and young people in Dakar and Lagos on mid-range Android phones (workers).
  The **sponsor** is an NGO, lab or company funding the dataset.

## Demo
- 3-minute script: [DEMO.md](DEMO.md)
- Video: *(link added at submission)*
- Live MVP: *(Vercel link added at submission)*

## How it works
```
 worker phone (browser)                         Next.js on Vercel                        elsewhere
 ┌───────────────────────────┐   signed Nostr   ┌──────────────────────────────┐
 │ /work: play clip, fix text│── event 4078 ───▶│ /api/corrections             │
 │ key in IndexedDB (no acct)│                  │  1 verify sig, time, replay   │
 │                           │                  │  2 deterministic checks       │
 │ /wallet: NWC string stays │                  │  3 gold clips (CER ≤ 0.15)    │──▶ Gemini judge (text only,
 │ on the phone              │                  │  4 LLM judge: flags only      │     untrusted-content wrapper)
 │   make_invoice ◀──NWC──┐  │   signed claim   │  5 k=3 consensus (medoid)     │
 │                        │  │── event 4079 ───▶│  6 payout rules → ledger      │──▶ Postgres (Neon): clips (Opus
 └────────────────────────┼──┘   (bolt11)       │  7 attestation kind 30078     │     bytea), corrections, ledger
                          │                     │ /api/claim → pay_invoice ─────┼──▶ sponsor wallet over NWC
   worker's own wallet ◀──┴──── Lightning ──────┴──────────────────────────────┘    (server env only)
                                                  attestation ──────────────────────▶ Nostr relays
```
- The app never holds money. The sponsor's wallet pays each claim directly to the worker's invoice.
- A worker is a random key on their phone: no name, phone number or email.

## Why Bitcoin / Lightning / Nostr
- **Lightning:** payouts of 20–40 sats (a few cents) to unbanked workers in Senegal and Nigeria the same way, settled in
  seconds, with no custody. Mobile money would need one integration per country and provider.
- **Nostr:** every correction is a Nostr event signed by the worker's key, so each one is pseudonymous and
  attributable without an account. Every finished clip gets a **server-signed attestation** (kind 30078: language,
  SHA-256 of the agreed text, contributor pubkeys, licence), giving the open dataset a provenance trail.
- **NWC:** workers connect any Nostr Wallet Connect wallet. The connection string stays in the browser.

## Where AI is used and how it's evaluated
AI proposes; rules decide.
- **Drafts:** a speech model writes the first transcript (Gemini for wo/pcm, Spitch for yo, via `pnpm drafts`).
  **In this demo the drafts are simulated** (see below) and the UI labels them "simulated draft".
- **Pricing by difficulty:** 20 sats base, +10 if draft confidence < 0.6, +10 if the clip is longer than 6 s. Amounts come
  only from this server-side table.
- **Fraud judge:** an LLM reads the corrected text (as untrusted data) and returns `plausible_language`, `gibberish`,
  `injection_text`, `offensive`. Hard flags reject. Its schema has **no amount or recipient field**, so it can't move money.
- **Never:** AI never picks amounts or recipients and never signs or pays anything.
- **Eval:** `pnpm eval` and `pnpm simulate` → [eval/RESULTS.md](eval/RESULTS.md). See [Metrics](#metrics).

## Security by design
Signed corrections and claims, replay protection (UNIQUE event id and payment hash), gold qualification, k=3 consensus,
daily caps, a sponsor pause switch, a nonce CSP with exact relay origins, zod on every route, rate limits, an allowlisted
logger (a test checks that no transcript, pubkey, invoice or token is ever logged), and secrets only in server env.
Full table: [THREAT_MODEL.md](THREAT_MODEL.md).

## Low-bandwidth UX
- **First-load JS:** about 155 KB gzipped on the landing page (509 KB raw), of which about 125 KB is React and the
  Next.js runtime. Measured on a production build with the browser's resource timing, then gzip -9 of the same chunks.
  The wallet SDK only loads on `/wallet` (`@sats/ui/lite`).
- **Fonts:** one display weight (Fraunces 700, about 18 KB woff2, self-hosted). Body text uses the phone's own Noto Sans
  or Roboto, which renders Yorùbá dot-below and tone marks.
- **Audio:** about 8.5 KB per clip (16 kHz mono Opus at 16 kb/s, silence trimmed), cached for a long time.
- **Offline:** an offline banner shows when the connection drops; PWA manifest and service worker.
- **Phone-first UI:** tap targets of 48 px or more (the main actions are 64 px), high-contrast indigo on paper,
  light and dark themes, and reduced-motion support. Tested at 375 px width.

## Setup (one command)
```bash
pnpm demo
```
Creates `.env.local` with generated secrets and test wallets (`--no-wallets` to skip), migrates and seeds clips and
personas, then builds and starts http://localhost:3000. Without a Gemini key it sets `AI_MOCK=1`. It needs a
`DATABASE_URL`: start local Postgres first with `docker compose --profile db up -d db` (host port 5433), or point it at
Neon.
Deploying to Vercel and Neon: [docs/DEPLOY.md](docs/DEPLOY.md).

Other commands:

| Command | What it does |
|---|---|
| `pnpm seed` | migrate, load `seed/` clips, run the scripted personas |
| `pnpm fetch:wolof` / `pnpm fetch:yoruba` | download the seed clips (see Seed data) |
| `pnpm pcm:import` | import the author's Pidgin recordings, matched against `seed/pcm_script.md` |
| `pnpm eval` / `pnpm simulate` | metrics below |
| `pnpm checkpoint` | end-to-end: fresh worker qualifies, forms consensus, claims into `NWC_LIVE_WORKER` |
| `pnpm typecheck && pnpm test && pnpm lint` | 140 tests |

## Seed data
| Language | Clips | Source | Audio licence | Transcript licence |
|---|---|---|---|---|
| Wolof | 40 (11 gold) | Hugging Face `galsenai/wolof-audio-data` (test split) | Apache-2.0 | CC-BY-4.0 |
| Yorùbá | 40 (11 gold) | OpenSLR SLR86, Google crowdsourced Yoruba (20 female, 20 male) | CC BY-SA 4.0 | **CC BY-SA 4.0** (share-alike, set per clip in the export and attestation) |
| Naija Pidgin | up to 20 | recorded by the author from `seed/pcm_script.md` | CC-BY-4.0 | CC-BY-4.0 |

All clips were converted with `ffmpeg-static` (no system ffmpeg needed). Details: [seed/LICENSES.md](seed/LICENSES.md).
Hausa is supported by the backend but has no seed clips (dropped for time).

## Metrics
Mocked or simulated rows are labelled.

| Metric | Value | How measured |
|---|---|---|
| Red-team attacks stopped | 10 / 10 | `pnpm eval`, full pipeline (paste-back, injection, gibberish, wrong language, copy, replay, forgery…) |
| Fraud precision / recall, deterministic checks only | 100% / 27% | 80 labelled submissions (30 bad), `eval/fraud.json` |
| Fraud precision / recall, with judge | 100% / 80% | same cases, **mock judge** (keyword heuristics under `AI_MOCK`) |
| Sats leaked to wrong transcripts | 0 in every run | `pnpm simulate`, 70/20/10 and 40/30/30 honest/lazy/malicious, **synthetic drafts** |
| Draft WER → consensus WER | wo 0.58 → 0.00, yo 0.74 → 0.00, pcm 0.83 → 0.00 | `pnpm eval`, **synthetic drafts** on 24 builder-written sentences |
| Sats per finished clip | 70 | `pnpm simulate` 70/20/10 (consensus payouts ÷ clips done) |
| Scoring latency | p50 28.5 ms, p95 76.3 ms | `pnpm eval`, local in-memory Postgres, mock judge |
| Live payout | 100 sats settled into the worker wallet | `pnpm checkpoint` on the local stack: 2 gold + 1 consensus clip, claim paid by the sponsor wallet over NWC |
| First-load JS | about 155 KB gzipped | see Low-bandwidth UX |
| LLM cost per clip | not measured | no Gemini key during the hackathon |

## Constraints & what's simulated
- **AI drafts are simulated.** No Gemini or Spitch key was available, so `pnpm drafts:simulated` made placeholder drafts
  by corrupting the known transcripts (`draft_model = "simulated"`). The UI labels them. With keys, `pnpm drafts` writes
  real drafts and nothing else changes.
- **The judge is mocked** (`AI_MOCK=1`): keyword and heuristic rules stand in for Gemini. The real judge code path exists
  and is tested with fixtures.
- **Eval data is synthetic:** 24 short sentences written by the builder, with synthetic drafts. It tests the scoring
  rules, not the AI.
- **Scripted personas:** three persona keys pre-submit two corrections on each clip, so a live worker's submission is
  the third and consensus forms on stage. Persona 3 sometimes pastes back the AI draft, to show that being rejected.
- **Wallets:** sponsor and worker wallets are test wallets with small balances.
- **Rate limits** are in memory, per server instance.

## Next steps
- Real drafts from a self-hosted Wolof ASR model (whosper / M-Kiriku) and Spitch for Yorùbá, then re-run the eval.
- The demand side as Nostr DVMs (NIP-90): dataset buyers post jobs, workers' corrections fill them.
- Cash-out to mobile money (Banxaas-style) for workers without a Lightning habit.
- Recording tasks (workers read prompts), Hausa seed clips, worker reputation beyond gold accuracy, mainnet sponsor
  onboarding.

## License
Code: MIT. Dataset transcripts: CC-BY-4.0, except Yorùbá (CC BY-SA 4.0, following its source).
Built on the shared `sats-starter` template (packages `@sats/core`, `lightning`, `nostr`, `ai`, `ui`, `payouts`).

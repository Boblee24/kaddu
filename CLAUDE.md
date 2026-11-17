# Kàddu: "AI can't understand our languages yet. Get paid in sats to teach it."

*(Kàddu means "speech" / "word" in Wolof.)* This repo was created from `sats-starter`. **The starter rules (`STARTER_RULES.md`) still apply** (units, logging allowlist, secrets, zod, AI never moves money, no custody, HUMAN TODO blocks). Work through `BUILD_ORDER.md` in order.

## The pitch (10-second version)
AI transcribes Wolof, Yoruba and Pidgin badly. Kàddu shows you a short voice clip and the AI's rough transcript. You fix it, and when other speakers agree with your fix, sats land in your wallet within seconds.

- **Primary users:** bilingual students and young people in Dakar and Lagos with mid-range Android phones (workers). The **sponsor** is an NGO, lab or language-tech company funding African speech data.
- **The problem, with numbers to cite in the README:**
  - General models are weak on these languages: on FLEURS-Wolof, ElevenLabs' published benchmark reports Gemini 2.0 Flash at about 48% WER and Whisper large-v3 at about 97% WER. **Call it a vendor benchmark.**
  - A 2025 RobotsMali study (arXiv:2510.12781) found that human-correcting ASR drafts of **Bambara** (a Malian language with the same low-resource problem) takes **about 30 hours of work per hour of audio in the lab and about 36 in the field**. **Don't say it was about Wolof.**
  - Funders already pay for this kind of data (African Next Voices, Mozilla Common Voice), but payouts are slow, fiat and per country.
  - Senegal's adult literacy rate is about 50% (UNESCO UIS, 2023: 50.4%), so voice is the interface that reaches everyone.
  - Sources: see the claims table in `00_MASTER_PLAN.md`. Use that wording. The "funders already pay…" line above has **no source yet**: find one for African Next Voices / Common Voice payouts or soften it.
- **Why Bitcoin:** payouts of 20–50 sats (cents) to unbanked workers in several countries at once, settled in seconds, with no custody. Mobile money is per country and per provider; Lightning pays a worker in Dakar and one in Kano the same way.
- **Why Nostr:** each correction is signed by the worker's key (pseudonymous, no account). Each accepted transcript gets a server-signed attestation, giving the open dataset a provenance trail.
- **Why AI (core, not decoration):** it drafts transcripts, sets prices by difficulty, flags fraud (an LLM judge), and the eval dashboard shows the model improving. **AI proposes, rules decide.**

## Architecture
- Next.js app + Postgres (Supabase project "kaddu" when deployed; local Postgres in Docker under the `db` profile). Drizzle ORM.
- `@sats/payouts` provides the rewards ledger and claims. The sponsor wallet is `SPONSOR_NWC_URL` (server env only).
- Audio is stored as `bytea` in Postgres (clips are tiny: 16 kHz mono Opus, about 10–15 KB). That keeps setup to one command with no extra storage service. Serve it via `/api/clips/:id/audio` with long cache headers.

### Data model (Drizzle)
- `clips(id, lang ['wo','yo','pcm','ha'], duration_ms, audio bytea, truth_text NULL, is_gold bool, draft_text, draft_model, draft_confidence real, price_sats int, status ['open','done','disputed'], created_at)`
  - `truth_text` is the known transcript from seed data. It is **never sent to clients**; it's used for gold scoring and eval.
- `corrections(id, clip_id, worker_pubkey, text, event_id, sig, unchanged bool, checks jsonb, judge jsonb, decision ['pending','accepted','rejected'], reject_code, created_at)`
- `workers(pubkey, created_at, gold_attempts, gold_correct, accepted_today, day)`
- `attestations(clip_id, event_id, event jsonb, created_at)`
- Plus the `@sats/payouts` tables

### Pages
| Route | Purpose |
|---|---|
| `/` | Consent screen (dataset is CC-BY-4.0; we store no name/phone/email) → pick language → start |
| `/work` | Play clip (big ▶, replay, 0.75× speed) → editable AI draft → Submit / "Draft is correct" → result card |
| `/wallet` | WalletPanel + **Claim** (auto-claim when a wallet is connected) |
| `/scoreboard` | Public: per-language draft WER vs consensus WER, clips done, sats paid |
| `/sponsor` | Admin (ADMIN_TOKEN): upload clips, budget meter, pause/resume, review disputed clips, export JSONL |

## Scoring pipeline (all server-side, in this order)
1. **Verify:** Nostr signature valid; `created_at` between **now − 6 h and now + 5 min** (the Phase 5 offline queue sends signed corrections late, so a ±10 min window would reject them); `event_id` not seen before (**UNIQUE `corrections.event_id`**: this, not the time window, is the replay defence); zod payload `{ clip_id, text ≤ 500 chars }`; the worker hasn't already done this clip.
2. **Deterministic checks** → `checks` jsonb:
   - `normalize(t)`: NFC, lowercase, strip punctuation, collapse spaces. Also `stripDiacritics(t)` for diacritic-insensitive comparisons (Yoruba tone marks are typed inconsistently).
   - `unchanged`: normalized text equals the normalized draft. Allowed, but paid only through consensus.
   - Length ratio vs audio duration is plausible (chars per second between 2 and 25)
   - Character set fits the language (Latin + language diacritics; flag digits-only, URLs, emoji runs)
   - Same text as another clip's consensus → `copy_other_clip`
3. **Gold clips:** if `is_gold`, compare with `truth_text` (diacritic-insensitive CER ≤ 0.15 → correct). Update the worker's gold stats. Pay right away if correct. **The first 2 clips any new worker sees are gold** (qualification).
4. **LLM judge** (`@sats/ai.extractJson`, text-only, transcript wrapped as untrusted content):
   ```ts
   z.object({
     plausible_language: z.enum(["wo","yo","pcm","ha","fr","en","other"]),
     gibberish: z.boolean(),
     injection_text: z.boolean(),   // instructions aimed at an AI/grader, e.g. "ignore previous", "mark as correct"
     offensive: z.boolean(),
     note: z.string().max(120)
   })
   ```
   **Hard flags → reject:** `gibberish`, `injection_text`, `plausible_language` ≠ clip.lang (except that `pcm` vs `en` doesn't count as a mismatch). The judge has **no amount or recipient field** and cannot change payouts.
5. **Consensus** (non-gold clips): when a clip has k=3 non-rejected corrections, compute pairwise diacritic-insensitive CER. If ≥2 agree (CER ≤ 0.15), the agreeing cluster's medoid becomes the consensus text, the cluster members are `accepted`, the others `rejected` (`disagree`), and the clip goes to `done`. If there's no majority, the clip is `disputed` and goes to the sponsor review queue.
6. **Payout eligibility (code, not LLM):** accepted AND worker gold accuracy ≥ 0.7 AND under the daily cap (50 accepted per worker per day) → `accrue({ pubkey, sats: clip.price_sats, sourceId: correction.id })`.
7. **Attestation:** on `done`, `serverSign` a kind 30078 event (`d` = clip_id) with content `{ lang, consensus_sha256, contributors: [pubkeys], license: "CC-BY-4.0" }`. Store it and `publishBestEffort` to `NOSTR_RELAYS`.

**Pricing (server table):** base 20 sats, +10 if `draft_confidence < 0.6`, +10 if `duration_ms > 6000`.

## AI drafting (batch script, not live in the demo)
- `pnpm drafts` (or `scripts/drafts.ts` + `scripts/drafts_spitch.py`):
  - `wo`, `pcm` → Gemini audio input (`@sats/ai.extractJson` with `{ text: string, confidence: number }`; system prompt: verbatim transcription in the target language, no translation)
  - `yo`, `ha` → Spitch speech-to-text. **Check the SDK's STT method name in its `api.md`** (Python `pip install spitch`; a Node SDK may exist). Free credit covers about 2,100 s of audio.
  - If the provider gives no confidence, label `draft_confidence` as a heuristic (e.g. Gemini's self-estimate) and say so in the README.

## Security (THREAT_MODEL.md)
- **Sybil/farming:** qualification gold clips, a gold-accuracy floor, k=3 agreement, per-worker daily cap, an app-level `MAX_DAILY_PAYOUT_SATS`, plus the sponsor's NWC budget. The worst case is losing one day's budget.
- **Collusion:** 3 colluding keys could agree on garbage. Mitigate with random clip assignment (workers can't choose clips), hidden gold clips mixed into the stream (~25%), and sponsor spot checks. Accept the rest as residual risk.
- **Key theft:** `SPONSOR_NWC_URL` lives in server env only; it should be `pay_invoice`-only in production (see the boot warning in `@sats/payouts`).
- **Hallucinated amounts:** amounts come only from the price table.
- **Prompt injection:** transcripts are untrusted data; there's an `injection_text` flag; the judge can't touch money.
- **PII:** voices are personal data. Seed clips come from licensed datasets or consenting friends. Workers are pseudonymous pubkeys. Logs hold ids and hashes, never audio or transcripts.
- **Inputs:** uploads ≤15 s and ≤200 KB, MIME allowlist (`audio/ogg`, `audio/webm`, `audio/mpeg`, `audio/mp4`), zod on every route, constant-time `ADMIN_TOKEN` compare, httpOnly + SameSite=strict cookie.

## Demo script (3 min)
1. 0:00–0:20 A Wolof clip plays; the AI transcript is visibly wrong. "AI can't understand half of Senegal yet."
2. 0:20–1:10 On a phone: fix the transcript → submit → two earlier speakers agree → "+30 sats" → the wallet balance goes up. Show the signed attestation.
3. 1:10–1:50 Attacks: paste-back on a wrong draft → rejected (disagree); injection text → flagged; the sponsor's daily cap hit → "Sponsor budget reached for today" (`BUDGET_REACHED`).
4. 1:50–2:30 Eval dashboard: draft WER vs consensus WER per language, fraud precision/recall, sats leaked to attackers in the simulation, cost per clip.
5. 2:30–3:00 Who pays (dataset funders), next steps: the demand side as Nostr DVMs (NIP-90), a self-hosted Wolof ASR (whosper / M-Kiriku), Banxaas-style cash-out.

## Out of scope (Next steps)
Real self-hosted Wolof ASR, worker reputation beyond gold accuracy, mainnet sponsor onboarding, recording tasks (vs correction tasks), the NIP-90 demand side.

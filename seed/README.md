# Seed data

`pnpm seed` (also run by `pnpm demo`) migrates the DB, loads clips, then runs the scripted personas.

```
seed/
  manifest.json          [{ "id", "lang", "file", "truth_text", "is_gold" }]
  clips/<lang>/<id>.ogg  16 kHz mono Opus, 3–10 s (max 15 s, 200 KB)
  drafts.json            optional, from `pnpm drafts` (Phase 3): { "<id>": { "text", "model", "confidence" } }
  LICENSES.md            source + licence of every clip, contributor consent
```

Example manifest entry:

```json
{ "id": "wo_001", "lang": "wo", "file": "clips/wo/wo_001.ogg", "truth_text": "Naka nga def?", "is_gold": false }
```

- `id`: lowercase `a-z 0-9 _ -`, max 64 chars. `lang`: `wo`, `yo`, `pcm` or `ha`.
- Mark about 25% of clips per language `"is_gold": true`, and at least 2 per language (qualification).
- `truth_text` is never sent to clients. Type it exactly as spoken (tone marks welcome; scoring ignores them).
- Scoring rejects corrections with fewer than 2 or more than 25 letters per second of audio,
  so trim long silences (a 6 s clip needs at least 12 letters of speech).

Convert a recording:

```bash
ffmpeg -i in.m4a -ac 1 -ar 16000 -c:a libopus -b:a 16k out.ogg
```

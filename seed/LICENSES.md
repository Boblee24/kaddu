# Seed audio: sources and licences

Voices are personal data. Every clip below comes from an openly licensed dataset or from the author.

| Clips | Source | Licence of the audio | Licence of Kàddu transcripts | How fetched |
|---|---|---|---|---|
| `wo_001`–`wo_040` | Hugging Face `galsenai/wolof-audio-data` (test split; sub-sources kallama, alffa, urban_bus) | Apache-2.0 | CC-BY-4.0 | `pnpm fetch:wolof` |
| `yo_001`–`yo_040` | OpenSLR SLR86, Google crowdsourced Yoruba (20 female + 20 male clips) | CC BY-SA 4.0 | **CC BY-SA 4.0** (share-alike; set per clip in the export and attestation) | `pnpm fetch:yoruba` |
| `pcm_01`–`pcm_20` | Recorded by the project author from `pcm_script.md` | CC-BY-4.0 (author's own) | CC-BY-4.0 | `pnpm pcm:import` |

Hausa has no seed clips (dropped for time); the backend still supports `ha`.
All clips: trimmed of leading/trailing silence, converted to 16 kHz mono Opus (16 kb/s) with ffmpeg-static.
The AI services that process clips are Google Gemini (drafts, judge) when a key is configured.

## Sources checked 2026-11-18
- **Wolof:** Hugging Face `galsenai/wolof-audio-data`, **Apache-2.0**, not gated. https://huggingface.co/datasets/galsenai/wolof-audio-data
- **Yoruba:** OpenSLR SLR86 (Google crowdsourced Yoruba), **CC BY-SA 4.0**. https://www.openslr.org/86/
  Share-alike: corrected transcripts derived from these clips must be released as CC BY-SA 4.0 (not CC-BY-4.0); mark it per clip in the export.
- **Pidgin:** recorded by the project author (see `pcm_script.md`); the author's own clips, CC-BY-4.0.
- Mozilla Common Voice (Yoruba, CC0) not used: OpenSLR SLR86 is a direct download with a clear licence, so it is simpler.

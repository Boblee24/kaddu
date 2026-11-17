#!/usr/bin/env python3
"""
Fetch up to 40 short Wolof clips + transcripts from Hugging Face `galsenai/wolof-audio-data`
into seed/clips/wo/ and seed/manifest.json (16 kHz mono Opus, 3-10 s, ~25% gold).

NOT RUN BY THE BUILD. Before running it:
  1. Open https://huggingface.co/datasets/galsenai/wolof-audio-data and read its licence and terms.
  2. Record the licence in seed/LICENSES.md. If it doesn't allow redistribution in a CC-BY-4.0 dataset
     and processing by AI services (Gemini, Spitch), don't use it.
  3. pip install "datasets[audio]" soundfile     (and have ffmpeg on PATH)
  4. python -I scripts/fetch_wolof.py --licence-checked [--split train] [--max 40]
     (If the dataset is gated, log in first: `huggingface-cli login`.)

The script streams the dataset, so it never downloads all of it. It detects the audio and text columns
because their names weren't checked when it was written; pass --audio-col / --text-col if detection fails.
It is idempotent: existing clip ids in seed/manifest.json are kept, not duplicated.
"""
import argparse
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed"
OUT = SEED / "clips" / "wo"
MANIFEST = SEED / "manifest.json"
TEXT_CANDIDATES = ["transcription", "transcript", "sentence", "text", "normalized_text", "raw_transcription"]


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--licence-checked", action="store_true", help="confirm you read the dataset licence and recorded it in seed/LICENSES.md")
    ap.add_argument("--dataset", default="galsenai/wolof-audio-data")
    ap.add_argument("--split", default="train")
    ap.add_argument("--max", type=int, default=40)
    ap.add_argument("--min-sec", type=float, default=3.0)
    ap.add_argument("--max-sec", type=float, default=10.0)
    ap.add_argument("--audio-col")
    ap.add_argument("--text-col")
    a = ap.parse_args()

    if not a.licence_checked:
        die("read the dataset licence first, record it in seed/LICENSES.md, then pass --licence-checked")
    if not shutil.which("ffmpeg"):
        die("ffmpeg not found on PATH")
    try:
        from datasets import Audio, load_dataset  # type: ignore
        import soundfile as sf  # type: ignore
    except ImportError:
        die('pip install "datasets[audio]" soundfile')

    ds = load_dataset(a.dataset, split=a.split, streaming=True)
    features = ds.features or {}
    audio_col = a.audio_col or next((k for k, v in features.items() if isinstance(v, Audio)), None)
    text_col = a.text_col or next((k for k in TEXT_CANDIDATES if k in features), None)
    if not audio_col or not text_col:
        die(f"could not detect columns (features: {list(features)}); pass --audio-col and --text-col")
    print(f"• columns: audio={audio_col} text={text_col}")
    ds = ds.cast_column(audio_col, Audio(sampling_rate=16000))

    manifest = json.loads(MANIFEST.read_text("utf8")) if MANIFEST.exists() else []
    have = {m["id"] for m in manifest}
    OUT.mkdir(parents=True, exist_ok=True)

    added = 0
    n = len([m for m in manifest if m["lang"] == "wo"])
    for row in ds:
        if added >= a.max:
            break
        text = str(row.get(text_col) or "").strip()
        audio = row[audio_col]
        arr, sr = audio["array"], audio["sampling_rate"]
        sec = len(arr) / sr
        if not text or len(text) > 400 or not (a.min_sec <= sec <= a.max_sec):
            continue
        # Plausibility: the app rejects < 2 or > 25 letters per second of audio.
        letters = sum(ch.isalpha() for ch in text)
        if not (2 <= letters / sec <= 25):
            continue
        n += 1
        clip_id = f"wo_{n:03d}"
        if clip_id in have:
            continue
        wav = io.BytesIO()
        sf.write(wav, arr, sr, format="WAV")
        dst = OUT / f"{clip_id}.ogg"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "16k", str(dst)],
            input=wav.getvalue(),
            check=True,
        )
        if dst.stat().st_size > 200_000:
            dst.unlink()
            continue
        manifest.append({"id": clip_id, "lang": "wo", "file": f"clips/wo/{clip_id}.ogg", "truth_text": text, "is_gold": added % 4 == 0})
        added += 1
        print(f"  + {clip_id} ({sec:.1f} s)")

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf8")
    gold = sum(1 for m in manifest if m["lang"] == "wo" and m["is_gold"])
    print(f"✓ added {added} Wolof clip(s); {gold} gold. Next: check a few by ear, then `pnpm seed`.")


if __name__ == "__main__":
    main()

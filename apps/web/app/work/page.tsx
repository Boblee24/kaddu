"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BigButton } from "@sats/ui/lite";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { hasConsent, LANG_LABELS, type WorkLang } from "@/lib/client";
import { KIND_CORRECTION, MAX_TEXT, type ClipTask, type SubmitResult } from "@/lib/protocol";

type Phase =
  | { k: "loading" }
  | { k: "empty" }
  | { k: "error"; code: string }
  | { k: "task"; clip: ClipTask }
  | { k: "result"; clip: ClipTask; r: SubmitResult };

const MESSAGES: Record<string, string> = {
  pending: "Saved. You get paid when two other speakers agree with you.",
  accepted: "Other speakers agree with you.",
  rejected: "Not accepted this time.",
  REPLAY: "Already submitted.",
  ALREADY_DONE: "You already did this clip.",
  CLIP_CLOSED: "Other speakers finished this clip. Try the next one.",
  STALE: "This correction is too old. Try the next clip.",
  RATE_LIMITED: "Slow down a little and try again.",
  OFFLINE: "No connection. Try again.",
  // Why a correction wasn't accepted or paid (codes from lib/score.ts).
  disagree: "Other speakers heard something different.",
  disputed: "Speakers disagree on this clip. A reviewer will decide.",
  gold_mismatch: "That doesn't match what was said. Listen again carefully on the next one.",
  low_gold_accuracy: "Accepted, but your accuracy is too low to be paid yet. Keep practising!",
  daily_cap: "Accepted. You reached today's limit; come back tomorrow.",
  empty: "Please type what you hear.",
  implausible_length: "That's too short or too long for this clip.",
  digits_only: "Please type the words you hear.",
  url: "Links aren't allowed.",
  emoji: "Emoji aren't allowed.",
  wrong_script: "Please type in Latin letters.",
  copy_other_clip: "That's the text of a different clip.",
  injection: "Flagged: this looks like instructions, not speech.",
  gibberish: "Flagged: this doesn't look like real words.",
  wrong_language: "Flagged: this doesn't look like the clip's language.",
};

function resultLine(r: Extract<SubmitResult, { ok: true }>): string {
  if (r.code && MESSAGES[r.code]) return MESSAGES[r.code]!;
  return MESSAGES[r.decision] ?? "";
}

const RING = 2 * Math.PI * 76; // circumference of the progress ring (r = 76)

/** Big round play button with an orange progress ring. Ring progress is an SVG attribute, so no inline styles. */
function Player({ src, slow }: { src: string; slow: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = slow ? 0.75 : 1;
  }, [slow]);

  function play() {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    if (a.ended || progress >= 1) a.currentTime = 0;
    a.playbackRate = slow ? 0.75 : 1;
    a.play().catch(() => {});
  }

  return (
    <div className="relative mx-auto size-44">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(1);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration > 0) setProgress(a.currentTime / a.duration);
        }}
      />
      <svg viewBox="0 0 176 176" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="88" cy="88" r="76" fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle
          cx="88"
          cy="88"
          r="76"
          fill="none"
          stroke="var(--sats)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - progress)}
        />
      </svg>
      <button
        type="button"
        onClick={play}
        aria-label={playing ? "Pause" : "Play the clip"}
        className={`adire absolute inset-4 flex items-center justify-center rounded-full shadow-[0_6px_0_var(--indigo-deep)] transition active:translate-y-1 active:shadow-none focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus)] ${playing ? "ripple" : ""}`}
      >
        <span className="flex size-20 items-center justify-center rounded-full bg-[var(--cream)] text-[var(--indigo)]">
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-9" aria-hidden>
              <rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor" />
              <rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-1 size-10" aria-hidden>
              <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}

function Work() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("lang");
  const lang = raw && raw in LANG_LABELS ? (raw as WorkLang) : null;
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!hasConsent() || !lang) {
      router.replace("/");
      return;
    }
    getOrCreateKey().then((k) => setPubkey(k.pubkey));
  }, [lang, router]);

  const load = useCallback(async () => {
    if (!pubkey || !lang) return;
    setPhase({ k: "loading" });
    try {
      const res = await fetch(`/api/next?lang=${lang}&pubkey=${pubkey}`);
      const body = (await res.json()) as { ok: boolean; clip?: ClipTask | null; code?: string };
      if (!body.ok) return setPhase({ k: "error", code: body.code ?? "ERROR" });
      if (!body.clip) return setPhase({ k: "empty" });
      setText(body.clip.draftText);
      setPhase({ k: "task", clip: body.clip });
    } catch {
      setPhase({ k: "error", code: "OFFLINE" });
    }
  }, [pubkey, lang]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(clip: ClipTask, value: string) {
    setBusy(true);
    try {
      const event = await signEvent({
        kind: KIND_CORRECTION,
        content: JSON.stringify({ clip_id: clip.id, text: value.trim().slice(0, MAX_TEXT) }),
        tags: [["clip", clip.id]],
      });
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      const r = (await res.json()) as SubmitResult;
      if (r.ok) setDone((n) => n + 1);
      setPhase({ k: "result", clip, r });
    } catch {
      setPhase({ k: "result", clip, r: { ok: false, code: "OFFLINE" } });
    } finally {
      setBusy(false);
    }
  }

  if (!lang) return null;
  return (
    <section className="flex flex-col gap-5 pt-1">
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="flex min-h-12 items-center gap-2 rounded-full border-2 border-[var(--fg)] px-4 font-semibold">
          <span aria-hidden className="adire size-3 rounded-full" />
          {LANG_LABELS[lang]}
        </Link>
        {done > 0 && <span className="text-sm font-semibold text-[var(--muted)]">{done} sent this session</span>}
      </div>

      {phase.k === "loading" && (
        <div className="flex flex-col items-center gap-4 py-10" role="status">
          <div className="adire size-36 animate-pulse rounded-full opacity-40" />
          <p className="text-[var(--muted)]">Loading the next clip…</p>
        </div>
      )}

      {phase.k === "empty" && (
        <div className="rise flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-6 text-center">
          <p className="font-display text-2xl">All done for now</p>
          <p>No {LANG_LABELS[lang]} clips left for you. New ones come in every day.</p>
          <Link href="/wallet" className="font-semibold underline underline-offset-4">
            Collect your sats →
          </Link>
        </div>
      )}

      {phase.k === "error" && (
        <div className="flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-6">
          <p className="text-lg font-semibold">{MESSAGES[phase.code] ?? "Something went wrong."}</p>
          <BigButton variant="secondary" onClick={load}>
            ↻ Try again
          </BigButton>
        </div>
      )}

      {phase.k === "task" && (
        <>
          <div className="rise flex flex-col items-center gap-3">
            <Player key={phase.clip.id} src={phase.clip.audioUrl} slow={slow} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={slow}
                onClick={() => setSlow((s) => !s)}
                className="min-h-12 rounded-full border-2 border-[var(--border)] px-4 font-semibold aria-pressed:border-[var(--fg)] aria-pressed:bg-[var(--fg)] aria-pressed:text-[var(--bg)]"
              >
                🐢 Slow
              </button>
              <span className="ticket rounded-lg px-3 py-1.5 font-bold text-[var(--sats)] tabular-nums">
                +{phase.clip.priceSats} sats
              </span>
              <span className="text-sm text-[var(--muted)] tabular-nums">{(phase.clip.durationMs / 1000).toFixed(1)} s</span>
            </div>
          </div>

          {phase.clip.draftText && (
            <div className="rise d1 rounded-2xl border-l-4 border-[var(--indigo)] bg-[var(--surface-2)] px-4 py-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--muted)]">
                The AI heard
                {phase.clip.draftSimulated && (
                  <span className="rounded-full border border-[var(--muted)] px-2 text-xs font-medium" title="No speech model was run for this demo clip">
                    simulated draft
                  </span>
                )}
              </p>
              <p className="text-lg italic" lang={lang === "pcm" ? "en" : lang}>
                “{phase.clip.draftText}”
              </p>
            </div>
          )}

          <label className="rise d2 flex flex-col gap-2">
            <span className="font-display text-xl">What do you hear? Fix it.</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_TEXT}
              rows={3}
              lang={lang === "pcm" ? "en" : lang}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="lined rounded-2xl border-2 border-[var(--fg)] px-4 py-2 text-2xl focus:outline-4 focus:outline-offset-2 focus:outline-[var(--focus)]"
            />
          </label>

          <div className="rise d3 flex flex-col gap-2">
            <BigButton className="min-h-16 text-xl" disabled={busy || text.trim().length === 0} onClick={() => submit(phase.clip, text)}>
              {busy ? "Sending…" : "✓ Send my version"}
            </BigButton>
            {phase.clip.draftText && (
              <BigButton variant="ghost" disabled={busy} onClick={() => submit(phase.clip, phase.clip.draftText)}>
                The AI got it right
              </BigButton>
            )}
          </div>
        </>
      )}

      {phase.k === "result" && <Result r={phase.r} onNext={load} />}
    </section>
  );
}

function Result({ r, onNext }: { r: SubmitResult; onNext: () => void }) {
  const paid = r.ok && r.decision === "accepted" && !!r.sats;
  const tone = !r.ok || r.decision === "rejected" ? "text-[var(--danger)]" : r.decision === "accepted" ? "text-[var(--ok)]" : "text-[var(--fg)]";
  const stamp = !r.ok ? "Not sent" : r.decision === "accepted" ? "Agreed" : r.decision === "pending" ? "Saved" : "Not accepted";
  return (
    <div className="rise flex flex-col items-center gap-4 rounded-3xl bg-[var(--surface)] px-5 py-8 text-center" role="status">
      {paid ? (
        <p className="pop font-display text-6xl text-[var(--sats)] tabular-nums">
          +{r.sats}
          <span className="ml-2 text-2xl">sats</span>
        </p>
      ) : (
        <p className={`pop font-display rounded-xl border-4 border-current px-4 py-1 text-3xl uppercase ${tone}`}>{stamp}</p>
      )}
      <p className="text-xl font-semibold">{r.ok ? resultLine(r) : (MESSAGES[r.code] ?? "Could not submit.")}</p>
      {paid && (
        <Link href="/wallet" className="font-semibold underline underline-offset-4">
          Send them to my wallet →
        </Link>
      )}
      {r.ok && r.attestationId && (
        <p className="w-full break-all rounded-lg bg-[var(--surface-2)] p-2 text-left font-mono text-xs text-[var(--muted)]">
          Signed attestation (Nostr): {r.attestationId}
        </p>
      )}
      <BigButton className="min-h-16 w-full text-xl" onClick={onNext}>
        Next clip →
      </BigButton>
    </div>
  );
}

export default function WorkPage() {
  return (
    <Suspense>
      <Work />
    </Suspense>
  );
}

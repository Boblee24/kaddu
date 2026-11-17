"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BigButton } from "@sats/ui";
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
  pending: "Saved. You get paid when other speakers agree with you.",
  accepted: "Other speakers agree with you.",
  rejected: "Not accepted this time.",
  REPLAY: "Already submitted.",
  ALREADY_DONE: "You already did this clip.",
  CLIP_CLOSED: "Other speakers finished this clip. Try the next one.",
  STALE: "This correction is too old. Try the next clip.",
  RATE_LIMITED: "Slow down a little and try again.",
  OFFLINE: "No connection. Try again.",
};

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
  const audio = useRef<HTMLAudioElement>(null);

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

  function play() {
    const a = audio.current;
    if (!a) return;
    a.playbackRate = slow ? 0.75 : 1;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

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
      setPhase({ k: "result", clip, r: (await res.json()) as SubmitResult });
    } catch {
      setPhase({ k: "result", clip, r: { ok: false, code: "OFFLINE" } });
    } finally {
      setBusy(false);
    }
  }

  if (!lang) return null;
  return (
    <section className="flex w-full max-w-xl flex-col gap-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{LANG_LABELS[lang]}</h1>
        <Link href="/wallet" className="font-medium underline-offset-4 hover:underline">
          My sats →
        </Link>
      </div>

      {phase.k === "loading" && <p className="text-[var(--muted)]">Loading clip…</p>}
      {phase.k === "empty" && <p>No clips left in {LANG_LABELS[lang]} for you right now. Come back later!</p>}
      {phase.k === "error" && (
        <div className="flex flex-col gap-3">
          <p>{MESSAGES[phase.code] ?? "Something went wrong."}</p>
          <BigButton variant="secondary" onClick={load}>
            ↻ Try again
          </BigButton>
        </div>
      )}

      {phase.k === "task" && (
        <>
          <audio ref={audio} src={phase.clip.audioUrl} preload="auto" />
          <div className="flex gap-2">
            <BigButton className="flex-1 text-3xl" aria-label="Play" onClick={play}>
              ▶
            </BigButton>
            <BigButton variant="secondary" aria-label="Replay" onClick={play}>
              ↺
            </BigButton>
            <BigButton variant="secondary" aria-pressed={slow} aria-label="Slow playback" onClick={() => setSlow((s) => !s)}>
              {slow ? "0.75×" : "1×"}
            </BigButton>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {(phase.clip.durationMs / 1000).toFixed(1)} s · earns {phase.clip.priceSats} sats when others agree
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Fix what the AI heard. Type exactly what is said.</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_TEXT}
              rows={4}
              lang={lang === "pcm" ? "en" : lang}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] p-3 text-2xl leading-snug focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-2">
            <BigButton disabled={busy || text.trim().length === 0} onClick={() => submit(phase.clip, text)}>
              ✓ Submit
            </BigButton>
            {phase.clip.draftText && (
              <BigButton variant="secondary" disabled={busy} onClick={() => submit(phase.clip, phase.clip.draftText)}>
                The AI got it right
              </BigButton>
            )}
          </div>
        </>
      )}

      {phase.k === "result" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" role="status">
          {phase.r.ok ? (
            <>
              {phase.r.decision === "accepted" && phase.r.sats ? (
                <p className="text-3xl font-bold text-[var(--ok)]">+{phase.r.sats} sats ⚡</p>
              ) : null}
              <p className="text-xl font-semibold">{MESSAGES[phase.r.decision]}</p>
            </>
          ) : (
            <p className="text-xl font-semibold">{MESSAGES[phase.r.code] ?? "Could not submit."}</p>
          )}
          <BigButton onClick={load}>Next clip →</BigButton>
        </div>
      )}
    </section>
  );
}

export default function WorkPage() {
  return (
    <Suspense>
      <Work />
    </Suspense>
  );
}

import Link from "next/link";
import { getDb } from "@/lib/db";
import { scoreboard } from "@/lib/scoreboard";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { wo: "Wolof", yo: "Yorùbá", pcm: "Naija Pidgin", ha: "Hausa" };
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

/** A horizontal bar drawn in SVG (width is an attribute, so the CSP's no-inline-style rule holds). */
function Bar({ value, tone, label }: { value: number | null; tone: "draft" | "people"; label: string }) {
  const w = value == null ? 0 : Math.max(2, Math.min(100, value * 100));
  return (
    <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-4 w-full overflow-visible rounded-full bg-[var(--surface-2)]" aria-hidden>
        <rect x="0" y="0" height="10" rx="5" width={w} className={tone === "draft" ? "fill-[var(--danger)]" : "fill-[var(--ok)]"} />
      </svg>
      <span className="text-right font-bold tabular-nums">{pct(value)}</span>
    </div>
  );
}

export default async function ScoreboardPage() {
  const s = await scoreboard(getDb());
  return (
    <section className="flex flex-col gap-6">
      <div className="rise flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight">How wrong is the AI?</h1>
        <p className="text-lg text-[var(--muted)]">
          Word error rate (WER) per language: the share of words that are wrong. <b className="text-[var(--fg)]">Lower is better.</b>
        </p>
      </div>

      <dl className="rise d1 grid grid-cols-3 gap-2">
        {[
          { k: "Sats earned", v: s.satsEarned.toLocaleString(), sats: true },
          { k: "Sats paid out", v: s.satsPaid.toLocaleString(), sats: true },
          { k: "Speakers", v: String(s.contributors), sats: false },
        ].map((x) => (
          <div key={x.k} className="flex flex-col-reverse rounded-2xl bg-[var(--surface)] p-3">
            <dt className="text-sm text-[var(--muted)]">{x.k}</dt>
            <dd className={`font-display text-3xl tabular-nums ${x.sats ? "text-[var(--sats)]" : ""}`}>{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        {s.langs.map((l, i) => (
          <article key={l.lang} className={`rise d${Math.min(4, i + 2)} flex flex-col gap-3 rounded-3xl bg-[var(--surface)] p-5`}>
            <header className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl">{NAMES[l.lang] ?? l.lang}</h2>
              <span className="text-sm text-[var(--muted)] tabular-nums">
                {l.done} / {l.clips} clips done
              </span>
            </header>
            <Bar value={l.draftWer} tone="draft" label="AI draft" />
            <Bar value={l.consensusWer} tone="people" label="Speakers" />
          </article>
        ))}
        {s.langs.length === 0 && <p className="text-[var(--muted)]">No clips yet.</p>}
      </div>

      <p className="text-sm text-[var(--muted)]">
        “AI draft” compares the draft to the text speakers agreed on. “Speakers” compares that agreed text to a known transcript, where one
        exists. Drafts are simulated until a speech model runs on these clips. Updated every minute. Method and simulated eval: eval/RESULTS.md.
      </p>
      <Link href="/" className="self-start font-semibold underline underline-offset-4">
        ← Start correcting
      </Link>
    </section>
  );
}

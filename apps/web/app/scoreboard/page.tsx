import Link from "next/link";
import { getDb } from "@/lib/db";
import { scoreboard } from "@/lib/scoreboard";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { wo: "Wolof", yo: "Yorùbá", pcm: "Naija Pidgin", ha: "Hausa" };
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

export default async function ScoreboardPage() {
  const s = await scoreboard(getDb());
  return (
    <section className="flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Scoreboard</h1>
      <p className="text-[var(--muted)]">
        How wrong the AI&apos;s first draft was, and how much speakers fixed. Word error rate (WER): lower is better.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead className="bg-[var(--surface-2)] text-sm">
            <tr>
              <th className="p-3">Language</th>
              <th className="p-3">Clips done</th>
              <th className="p-3">AI draft WER</th>
              <th className="p-3">Speakers&apos; WER</th>
            </tr>
          </thead>
          <tbody>
            {s.langs.map((l) => (
              <tr key={l.lang} className="border-t border-[var(--border)]">
                <td className="p-3 font-semibold">{NAMES[l.lang]}</td>
                <td className="p-3">
                  {l.done} / {l.clips}
                </td>
                <td className="p-3">{pct(l.draftWer)}</td>
                <td className="p-3">{pct(l.consensusWer)}</td>
              </tr>
            ))}
            {s.langs.length === 0 && (
              <tr>
                <td className="p-3 text-[var(--muted)]" colSpan={4}>
                  No clips yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-[var(--surface)] p-3">
          <dt className="text-sm text-[var(--muted)]">Sats earned</dt>
          <dd className="text-xl font-bold">{s.satsEarned.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-[var(--surface)] p-3">
          <dt className="text-sm text-[var(--muted)]">Sats paid out</dt>
          <dd className="text-xl font-bold">{s.satsPaid.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-[var(--surface)] p-3">
          <dt className="text-sm text-[var(--muted)]">Speakers</dt>
          <dd className="text-xl font-bold">{s.contributors}</dd>
        </div>
      </dl>
      <p className="text-xs text-[var(--muted)]">
        AI draft WER compares the draft to the speakers&apos; agreed text. Speakers&apos; WER compares that text to a known transcript, where
        one exists. Updated every minute. Full method and simulated eval: eval/RESULTS.md.
      </p>
      <Link href="/" className="font-medium underline">
        ← Start correcting
      </Link>
    </section>
  );
}

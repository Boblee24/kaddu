"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BigButton } from "@sats/ui/lite";
import { exportBackup, getOrCreateKey, isBackedUp } from "@sats/nostr/browser";
import { giveConsent, hasConsent, LANG_LABELS, saveLang, savedLang, type WorkLang } from "@/lib/client";

/** Each language greets in its own words. */
const GREETING: Record<WorkLang, string> = { wo: "Nanga def?", yo: "Ẹ kú àbọ̀!", pcm: "How far?" };
const WHERE: Record<WorkLang, string> = { wo: "Senegal · Gambia", yo: "Nigeria · Benin", pcm: "Nigeria" };

const STEPS = [
  { n: "1", title: "Listen", body: "a 3 to 10 second voice clip" },
  { n: "2", title: "Fix", body: "what the AI got wrong" },
  { n: "3", title: "Earn", body: "20–40 sats when 2 other speakers agree" },
];

export default function Home() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [lang, setLang] = useState<WorkLang | null>(null);
  const [backedUp, setBackedUp] = useState(true);
  const [nsec, setNsec] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // Restore saved choices after hydration (localStorage isn't available on the server).
    setConsent(hasConsent());
    setLang(savedLang());
    isBackedUp().then(setBackedUp, () => {});
  }, []);

  async function start() {
    if (!lang) return;
    setStarting(true);
    giveConsent();
    saveLang(lang);
    await getOrCreateKey();
    router.push(`/work?lang=${lang}`);
  }

  return (
    <section className="flex flex-col gap-7 pt-2">
      <div className="rise flex flex-col gap-3">
        <h1 className="font-display text-[2.4rem] leading-[1.05]">
          AI can&apos;t understand our languages yet. <span className="text-[var(--sats)]">Get paid in sats</span> to teach it.
        </h1>
        <p className="text-lg text-[var(--muted)]">Kàddu means “speech” in Wolof.</p>
      </div>

      <ol className="rise d1 grid grid-cols-3 gap-2">
        {STEPS.map((s) => (
          <li key={s.n} className="flex flex-col gap-1 rounded-2xl bg-[var(--surface)] p-3">
            <span className="font-display flex size-9 bg-[var(--fg)] text-[var(--bg)] items-center justify-center rounded-full text-lg">{s.n}</span>
            <span className="font-display text-lg leading-tight">{s.title}</span>
            <span className="text-sm leading-snug text-[var(--muted)]">{s.body}</span>
          </li>
        ))}
      </ol>

      <fieldset className="rise d2 flex flex-col gap-2">
        <legend className="font-display mb-2 text-2xl">Which language do you speak?</legend>
        {(Object.keys(LANG_LABELS) as WorkLang[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className="group flex min-h-16 items-center gap-4 rounded-2xl border-2 border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left transition aria-pressed:border-[var(--fg)] aria-pressed:shadow-[4px_4px_0_var(--fg)]"
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--fg)] group-aria-pressed:bg-[var(--fg)] group-aria-pressed:text-[var(--bg)]"
            >
              {lang === l ? "✓" : ""}
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-xl font-bold">{LANG_LABELS[l]}</span>
              <span className="text-sm text-[var(--muted)]">{WHERE[l]}</span>
            </span>
            <span className="font-display text-lg italic text-[var(--muted)]" lang={l === "pcm" ? "en" : l}>
              {GREETING[l]}
            </span>
          </button>
        ))}
      </fieldset>

      <div className="rise d3 rounded-2xl border-2 border-dashed border-[var(--border)] p-4">
        <h2 className="font-display mb-2 text-xl">Before you start</h2>
        <ul className="flex flex-col gap-1.5 text-base">
          <li>• Your fixes go into an open dataset anyone can use (CC-BY-4.0; Yorùbá text CC BY-SA 4.0, like its source).</li>
          <li>• No name, phone number or email. You are a random key on this phone.</li>
          <li>• Each fix is signed with that key and checked for spam.</li>
          <li>• Payouts come from a sponsor&apos;s capped daily budget.</li>
        </ul>
        <label className="mt-3 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl bg-[var(--surface)] px-3 text-lg font-semibold">
          <input type="checkbox" className="size-7 accent-[var(--indigo)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I
          agree
        </label>
      </div>

      <BigButton className="rise d4 min-h-16 text-xl" disabled={!consent || !lang || starting} onClick={start}>
        {starting ? "Getting a clip…" : lang ? `Start in ${LANG_LABELS[lang]} →` : "Pick a language to start"}
      </BigButton>

      {!backedUp && (
        <div className="rounded-2xl border-2 border-[var(--warn)] bg-[var(--surface)] p-4 text-base">
          {nsec ? (
            <>
              <p className="mb-2 font-semibold">Write this down. It is the only way to recover your earnings on a new phone.</p>
              <code className="block break-all rounded bg-[var(--surface-2)] p-2 text-sm">{nsec}</code>
            </>
          ) : (
            <>
              <p className="mb-2">Your key lives only on this phone. Back it up so you don&apos;t lose your sats.</p>
              <BigButton variant="secondary" onClick={async () => setNsec(await exportBackup())}>
                Show my backup key
              </BigButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}

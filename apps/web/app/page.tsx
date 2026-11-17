"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BigButton } from "@sats/ui";
import { exportBackup, getOrCreateKey, isBackedUp } from "@sats/nostr/browser";
import { giveConsent, hasConsent, LANG_LABELS, saveLang, savedLang, type WorkLang } from "@/lib/client";

export default function Home() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [lang, setLang] = useState<WorkLang | null>(null);
  const [backedUp, setBackedUp] = useState(true);
  const [nsec, setNsec] = useState<string | null>(null);

  useEffect(() => {
    // Restore saved choices after hydration (localStorage isn't available on the server).
    setConsent(hasConsent());
    setLang(savedLang());
    isBackedUp().then(setBackedUp, () => {});
  }, []);

  async function start() {
    if (!lang) return;
    giveConsent();
    saveLang(lang);
    await getOrCreateKey();
    router.push(`/work?lang=${lang}`);
  }

  return (
    <section className="flex w-full max-w-xl flex-col gap-5 pt-4">
      <h1 className="text-3xl font-bold leading-tight">AI can&apos;t understand our languages yet. Get paid in sats to teach it.</h1>
      <p className="text-[var(--muted)]">
        Listen to a short voice clip, fix the AI&apos;s transcript, and earn 20–40 sats when other speakers agree with you.
      </p>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 text-lg font-semibold">Before you start</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Your corrections go into an open dataset under the CC-BY-4.0 licence.</li>
          <li>We store no name, phone number or email. You are a random key on this phone.</li>
          <li>Your corrections are signed with that key and checked by AI for spam.</li>
          <li>This demo pays test sats.</li>
        </ul>
        <label className="mt-3 flex min-h-12 items-center gap-3 text-base font-medium">
          <input type="checkbox" className="size-6" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-lg font-semibold">Which language do you speak?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(LANG_LABELS) as WorkLang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`min-h-14 rounded-xl border-2 px-3 text-lg font-semibold ${
                lang === l ? "border-[var(--accent)] bg-[var(--surface-2)]" : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </fieldset>

      <BigButton disabled={!consent || !lang} onClick={start}>
        ▶ Start
      </BigButton>

      {!backedUp && (
        <div className="rounded-2xl border border-[var(--warn)] p-4 text-sm">
          {nsec ? (
            <>
              <p className="mb-2 font-semibold">Write this down. It is the only way to recover your earnings on a new phone.</p>
              <code className="block break-all rounded bg-[var(--surface-2)] p-2">{nsec}</code>
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

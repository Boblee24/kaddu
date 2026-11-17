"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BigButton } from "@sats/ui";

type Overview = {
  byStatus: Array<{ lang: string; status: string; n: number }>;
  spentToday: number;
  paidTotal: number;
  paused: boolean;
  dailyCap: number;
  budget: { usedSats: number; totalSats: number; renewsAt?: number } | null;
  wallet: "ok" | "missing" | "error";
};
type Disputed = Array<{ id: string; lang: string; draft: string; corrections: Array<{ id: string; text: string }> }>;

const card = "w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4";

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {total.toLocaleString()} sats
        </span>
      </div>
      {/* Native <progress>: inline style widths would be blocked by the CSP. */}
      <progress
        className={`mt-1 h-3 w-full ${pct >= 90 ? "accent-[var(--danger)]" : "accent-[var(--accent)]"}`}
        value={Math.min(used, total)}
        max={Math.max(total, 1)}
        aria-label={label}
      />
      {pct >= 90 && <p className="text-sm text-[var(--danger)]">{pct}% used</p>}
    </div>
  );
}

export default function SponsorPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [disputed, setDisputed] = useState<Disputed>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/sponsor/overview");
    if (r.status === 401) return setAuthed(false);
    setAuthed(true);
    setO((await r.json()) as Overview);
    const d = (await (await fetch("/api/sponsor/disputed")).json()) as { clips: Disputed };
    setDisputed(d.clips ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = new FormData(e.currentTarget).get("token");
    const r = await fetch("/api/sponsor/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (r.ok) {
      setMsg(null);
      await load();
    } else setMsg(r.status === 429 ? "Too many attempts. Wait a minute." : "Wrong token.");
  }

  async function post(path: string, body: unknown) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { ok: boolean; code?: string };
    setMsg(j.ok ? "Done." : `Failed: ${j.code}`);
    await load();
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("is_gold", fd.get("is_gold") ? "1" : "0");
    const r = await fetch("/api/sponsor/upload", { method: "POST", body: fd });
    const j = (await r.json()) as { ok: boolean; code?: string; id?: string; priceSats?: number };
    setMsg(j.ok ? `Uploaded ${j.id} (${j.priceSats} sats).` : `Upload failed: ${j.code}`);
    if (j.ok) form.reset();
    await load();
  }

  if (authed === null) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!authed)
    return (
      <form onSubmit={login} className={`${card} flex max-w-md flex-col gap-3`}>
        <h1 className="text-xl font-bold">Sponsor console</h1>
        <label className="flex flex-col gap-1">
          Admin token
          <input name="token" type="password" autoComplete="current-password" required className="min-h-12 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
        </label>
        <BigButton type="submit">Sign in</BigButton>
        {msg && <p role="alert">{msg}</p>}
      </form>
    );

  const langs = [...new Set(o?.byStatus.map((b) => b.lang) ?? [])];
  const count = (lang: string, status: string) => o?.byStatus.find((b) => b.lang === lang && b.status === status)?.n ?? 0;

  return (
    <section className="flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sponsor console</h1>
        <button className="underline" onClick={() => post("/api/sponsor/logout", {}).then(() => setAuthed(false))}>
          Sign out
        </button>
      </div>
      {msg && <p role="status" className="font-medium">{msg}</p>}

      {o && (
        <div className={`${card} flex flex-col gap-3`}>
          <h2 className="font-semibold">Budget</h2>
          <Meter used={o.spentToday} total={o.dailyCap} label="Paid + pending today (app cap)" />
          {o.budget ? (
            <Meter used={o.budget.usedSats} total={o.budget.totalSats} label="Sponsor wallet budget (NWC)" />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              {o.wallet === "missing" ? "No sponsor wallet configured (SPONSOR_NWC_URL)." : o.wallet === "error" ? "Sponsor wallet unreachable." : "This wallet doesn't report a budget."}
            </p>
          )}
          <p className="text-sm">Paid out in total: {o.paidTotal.toLocaleString()} sats</p>
          <BigButton variant={o.paused ? "primary" : "danger"} onClick={() => post("/api/sponsor/pause", { paused: !o.paused })}>
            {o.paused ? "▶ Resume payouts" : "⏸ Pause payouts"}
          </BigButton>
          {o.paused && <p className="text-sm">Payouts are paused. Workers keep earning; claims wait until you resume.</p>}
        </div>
      )}

      <div className={card}>
        <h2 className="mb-2 font-semibold">Clips</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>Lang</th>
              <th>Open</th>
              <th>Done</th>
              <th>Disputed</th>
            </tr>
          </thead>
          <tbody>
            {langs.map((l) => (
              <tr key={l}>
                <td>{l}</td>
                <td>{count(l, "open")}</td>
                <td>{count(l, "done")}</td>
                <td>{count(l, "disputed")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a href="/api/sponsor/export" className="mt-3 inline-block font-medium underline">
          ⬇ Export dataset (JSONL)
        </a>
      </div>

      <div className={card}>
        <h2 className="mb-2 font-semibold">Review disputed clips ({disputed.length})</h2>
        {disputed.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing to review.</p>}
        {disputed.map((d) => (
          <div key={d.id} className="mb-4 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">
                {d.id} · {d.lang}
              </span>
              <audio controls preload="none" src={`/api/clips/${d.id}/audio`} className="h-8" />
            </div>
            <p className="text-sm text-[var(--muted)]">AI draft: {d.draft || "(none)"}</p>
            {d.corrections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span>{c.text}</span>
                <button className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1" onClick={() => post("/api/sponsor/resolve", { clip_id: d.id, correction_id: c.id })}>
                  This is correct
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <form onSubmit={upload} className={`${card} flex flex-col gap-2`}>
        <h2 className="font-semibold">Upload a clip</h2>
        <p className="text-sm text-[var(--muted)]">≤15 s, ≤200 KB, ogg/webm/mp3/m4a. Only upload voices you have consent for.</p>
        <input name="file" type="file" accept="audio/ogg,audio/webm,audio/mpeg,audio/mp4" required />
        <input name="id" placeholder="id, e.g. wo_041" pattern="[a-z0-9_-]{1,64}" required className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
        <select name="lang" required className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3">
          <option value="wo">Wolof</option>
          <option value="yo">Yorùbá</option>
          <option value="pcm">Naija Pidgin</option>
          <option value="ha">Hausa</option>
        </select>
        <input name="truth_text" placeholder="Known transcript (optional; required for gold)" maxLength={500} className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
        <label className="flex items-center gap-2">
          <input name="is_gold" type="checkbox" value="1" /> Gold clip (hidden quality check)
        </label>
        <BigButton type="submit" variant="secondary">
          Upload
        </BigButton>
      </form>
    </section>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BigButton, SatsAmount, WalletPanel, useRates } from "@sats/ui";
import type { Wallet, WalletInfo } from "@sats/lightning";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { KIND_CLAIM } from "@/lib/protocol";
import { savedLang } from "@/lib/client";
import { useAppLang } from "../shell";

type ClaimResponse = { status: "paid" | "pending" | "rejected"; sats?: number; code?: string };

const CLAIM_TEXT: Record<string, string> = {
  BUDGET_REACHED: "Sponsor budget reached for today; your sats are saved and you can claim tomorrow.",
  DAILY_CAP: "Sponsor budget reached for today; your sats are saved and you can claim tomorrow.",
  OVER_MAX_CLAIM: "That's more than one claim allows. Try again for a smaller amount.",
  PAY_FAILED: "The payment failed. Your sats are saved; try again later.",
  RATE_LIMITED: "Too many tries. Wait a minute.",
  PAUSED: "The sponsor paused payouts for now; your sats are saved and you can claim later.",
};

/** Earned-but-not-sent sats for this phone's key. Works without a wallet connected. */
function useClaimable() {
  const [claimable, setClaimable] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const { pubkey } = await getOrCreateKey();
      const r = (await (await fetch(`/api/balance?pubkey=${pubkey}`)).json()) as { ok: boolean; claimable?: number };
      const c = r.ok ? (r.claimable ?? 0) : 0;
      setClaimable(c);
      return c;
    } catch {
      return 0;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { claimable, load };
}

function ClaimBox({ wallet, info, refresh, claimable, reload }: { wallet: Wallet; info: WalletInfo; refresh: () => void; claimable: number | null; reload: () => Promise<number> }) {
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);
  const canInvoice = info.methods.includes("make_invoice");

  const doClaim = useCallback(
    async (sats: number) => {
      if (sats <= 0 || !canInvoice) return;
      setBusy(true);
      setMsg({ text: "Sending your sats…", good: true });
      try {
        const inv = await wallet.makeInvoice({ sats, memo: "Kàddu payout", expirySec: 600 });
        const event = await signEvent({ kind: KIND_CLAIM, content: inv.bolt11, tags: [["t", "kaddu-claim"]] });
        const res = await fetch("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) });
        const r = (await res.json()) as ClaimResponse;
        if (r.status === "paid") setMsg({ text: `+${r.sats} sats landed in your wallet ⚡`, good: true });
        else if (r.status === "pending") setMsg({ text: "Payment on its way. It can take a minute.", good: true });
        else setMsg({ text: CLAIM_TEXT[r.code ?? ""] ?? `Could not claim (${r.code}).`, good: false });
      } catch {
        setMsg({ text: "Could not reach your wallet. Try again.", good: false });
      } finally {
        setBusy(false);
        await reload();
        refresh();
      }
    },
    [wallet, canInvoice, reload, refresh],
  );

  // Auto-claim once when the worker's own wallet is connected and there is something to claim.
  useEffect(() => {
    if (tried.current || claimable === null || claimable <= 0 || !canInvoice) return;
    tried.current = true;
    void doClaim(claimable);
  }, [claimable, canInvoice, doClaim]);

  return (
    <div className="flex flex-col gap-2">
      {!canInvoice && <p className="text-base">This wallet connection can&apos;t create invoices, so we can&apos;t send you sats. Make a new connection with “receive” allowed.</p>}
      {msg && (
        <p role="status" className={`rounded-xl px-3 py-2 text-lg font-semibold ${msg.good ? "bg-[var(--surface-2)]" : "border-2 border-[var(--danger)] text-[var(--danger)]"}`}>
          {msg.text}
        </p>
      )}
      {claimable !== null && claimable > 0 && canInvoice && (
        <BigButton className="min-h-16 text-xl" disabled={busy} onClick={() => doClaim(claimable)}>
          ⚡ Send {claimable} sats to my wallet
        </BigButton>
      )}
    </div>
  );
}

export default function WalletPage() {
  const lang = useAppLang();
  const rates = useRates();
  const { claimable, load } = useClaimable();
  const [workLang, setWorkLang] = useState<string | null>(null);
  useEffect(() => setWorkLang(savedLang()), []);
  const currency = lang === "fr" || workLang === "wo" ? "XOF" : "NGN";

  return (
    <>
      <h1 className="sr-only">Wallet</h1>
      <div className="rise adire relative overflow-hidden rounded-3xl p-1.5">
        <div className="flex flex-col gap-1 rounded-[1.25rem] bg-[var(--surface)] px-5 py-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Earned, waiting for you</p>
          <div className="font-display text-[var(--sats)]">
            {claimable === null ? <span className="text-5xl">…</span> : <SatsAmount sats={claimable} rates={rates} currency={currency} size="xl" />}
          </div>
          <p className="text-base text-[var(--muted)]">
            {claimable ? "Connect your Lightning wallet below and they are sent automatically." : "Fix clips to earn. Sats show here once other speakers agree with you."}
          </p>
        </div>
      </div>

      <div className="rise d1">
        <WalletPanel slot="wallet" lang={lang} rates={rates} currency={currency} warnIfCanSpend={false}>
          {(ctx) => <ClaimBox {...ctx} claimable={claimable} reload={load} />}
        </WalletPanel>
      </div>

      <details className="rise d2 rounded-2xl bg-[var(--surface)] p-4 text-base">
        <summary className="min-h-8 cursor-pointer font-semibold">No wallet yet?</summary>
        <p className="mt-2">
          You need a Lightning wallet that supports <b>Nostr Wallet Connect (NWC)</b>. Open its settings, create a connection that can
          <i> receive</i>, and paste the <code>nostr+walletconnect://</code> string above. It stays on this phone; we never see it.
        </p>
      </details>

      <Link href={workLang ? `/work?lang=${workLang}` : "/"} className="self-start font-semibold underline underline-offset-4">
        ← Back to clips
      </Link>
    </>
  );
}

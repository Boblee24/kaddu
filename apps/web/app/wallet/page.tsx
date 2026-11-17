"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BigButton, SatsAmount, WalletPanel, useRates } from "@sats/ui";
import type { Wallet, WalletInfo } from "@sats/lightning";
import { getOrCreateKey, signEvent } from "@sats/nostr/browser";
import { KIND_CLAIM } from "@/lib/protocol";
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

function ClaimBox({ wallet, info, refresh }: { wallet: Wallet; info: WalletInfo; refresh: () => void }) {
  const [claimable, setClaimable] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);
  const canInvoice = info.methods.includes("make_invoice");

  const loadBalance = useCallback(async () => {
    const { pubkey } = await getOrCreateKey();
    const r = (await (await fetch(`/api/balance?pubkey=${pubkey}`)).json()) as { ok: boolean; claimable?: number };
    const c = r.ok ? (r.claimable ?? 0) : 0;
    setClaimable(c);
    return c;
  }, []);

  const doClaim = useCallback(
    async (sats: number) => {
      if (sats <= 0 || !canInvoice) return;
      setBusy(true);
      setMsg("Claiming…");
      try {
        const inv = await wallet.makeInvoice({ sats, memo: "Kàddu payout", expirySec: 600 });
        const event = await signEvent({ kind: KIND_CLAIM, content: inv.bolt11, tags: [["t", "kaddu-claim"]] });
        const res = await fetch("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) });
        const r = (await res.json()) as ClaimResponse;
        if (r.status === "paid") setMsg(`+${r.sats} sats sent to your wallet ⚡`);
        else if (r.status === "pending") setMsg("Payment on its way. It can take a minute.");
        else setMsg(CLAIM_TEXT[r.code ?? ""] ?? `Could not claim (${r.code}).`);
      } catch {
        setMsg("Could not reach your wallet. Try again.");
      } finally {
        setBusy(false);
        await loadBalance();
        refresh();
      }
    },
    [wallet, canInvoice, loadBalance, refresh],
  );

  // Auto-claim once when the worker's own wallet is connected and there is something to claim.
  useEffect(() => {
    let cancelled = false;
    loadBalance().then((c) => {
      if (!cancelled && !tried.current && c > 0) {
        tried.current = true;
        void doClaim(c);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBalance, doClaim]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3">
      <p className="text-sm text-[var(--muted)]">Earned, not yet sent</p>
      <p className="text-2xl font-bold">{claimable === null ? "…" : <SatsAmount sats={claimable} />}</p>
      {!canInvoice && <p className="text-sm">This wallet connection can&apos;t create invoices, so we can&apos;t send you sats.</p>}
      {msg && (
        <p role="status" className="font-medium">
          {msg}
        </p>
      )}
      {claimable !== null && claimable > 0 && canInvoice && (
        <BigButton disabled={busy} onClick={() => doClaim(claimable)}>
          ⚡ Claim {claimable} sats
        </BigButton>
      )}
    </div>
  );
}

export default function WalletPage() {
  const lang = useAppLang();
  const rates = useRates();
  return (
    <>
      <h1 className="sr-only">Wallet</h1>
      <WalletPanel slot="wallet" lang={lang} rates={rates} currency={lang === "fr" ? "XOF" : "NGN"} warnIfCanSpend={false}>
        {(ctx) => <ClaimBox {...ctx} />}
      </WalletPanel>
      <Link href="/" className="font-medium underline-offset-4 hover:underline">
        ← Back to work
      </Link>
    </>
  );
}

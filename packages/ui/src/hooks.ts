"use client";
import { useCallback, useEffect, useState } from "react";
import { get, set, del } from "idb-keyval";
import { errorCode, isLang, type Lang, type Rates } from "@sats/core";
import { connectWallet, parseNwcUrl, type Wallet, type WalletInfo } from "@sats/lightning";

export type ConnStatus = "loading" | "disconnected" | "connecting" | "connected" | "error";

/**
 * An NWC connection stored ONLY in this browser's IndexedDB under `sats:nwc:<slot>`.
 * The connection string is never sent to the server.
 */
export function useWalletConnection(slot = "wallet") {
  const key = `sats:nwc:${slot}`;
  const [status, setStatus] = useState<ConnStatus>("loading");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True while the second (longer) connection attempt runs, so the UI can say "still connecting…". */
  const [retrying, setRetrying] = useState(false);

  const connect = useCallback(
    async (nwcUrl: string, persist = true) => {
      setError(null);
      try {
        parseNwcUrl(nwcUrl);
      } catch {
        setError("INVALID_NWC_URL");
        setStatus("disconnected");
        return false;
      }
      setStatus("connecting");
      setRetrying(false);
      try {
        // A cold relay connection can miss the first timeout; connectWallet retries once (15 s, then 30 s).
        const { wallet: w, info: i } = await connectWallet(nwcUrl, { onRetry: () => setRetrying(true) });
        if (persist) await set(key, nwcUrl.trim());
        setWallet(w);
        setInfo(i);
        setStatus("connected");
        return true;
      } catch (err) {
        setError(errorCode(err));
        setStatus("error");
        return false;
      } finally {
        setRetrying(false);
      }
    },
    [key],
  );

  const disconnect = useCallback(async () => {
    wallet?.close();
    await del(key);
    setWallet(null);
    setInfo(null);
    setStatus("disconnected");
  }, [key, wallet]);

  useEffect(() => {
    let cancelled = false;
    get<string>(key)
      .then((saved) => {
        if (cancelled) return;
        if (saved) void connect(saved, false);
        else setStatus("disconnected");
      })
      .catch(() => !cancelled && setStatus("disconnected"));
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => () => wallet?.close(), [wallet]);

  return { status, wallet, info, error, retrying, connect, disconnect };
}

let ratesCache: { at: number; rates: Rates } | null = null;

/** BTC price in NGN/XOF from the app's /api/rates (cached 10 min in memory). */
export function useRates(path = "/api/rates"): Rates | null {
  const [rates, setRates] = useState<Rates | null>(ratesCache?.rates ?? null);
  useEffect(() => {
    if (ratesCache && Date.now() - ratesCache.at < 600_000) return;
    let cancelled = false;
    fetch(path)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Rates | null) => {
        if (!j || cancelled || !(j.NGN > 0 && j.XOF > 0)) return;
        ratesCache = { at: Date.now(), rates: j };
        setRates(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  return rates;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** UI language remembered per device (a convenience; falls back silently if storage is blocked). */
export function useLang(fallback: string = "en"): [string, (l: string) => void] {
  const [lang, setLangState] = useState(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sats:lang");
      if (saved) setLangState(saved);
      else if (isLang(navigator.language.slice(0, 2))) setLangState(navigator.language.slice(0, 2) as Lang);
    } catch {
      /* storage blocked */
    }
  }, []);
  const setLang = useCallback((l: string) => {
    setLangState(l);
    try {
      localStorage.setItem("sats:lang", l);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") document.documentElement.lang = l === "pcm" ? "en" : l;
  }, []);
  return [lang, setLang];
}

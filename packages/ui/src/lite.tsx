"use client";
/**
 * The light half of @sats/ui: no wallet, QR or Lightning imports, so pages that only need a button,
 * the banners or the language hook don't pull the wallet SDK into their first-load JS.
 */
import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { isLang, t, type Lang } from "@sats/core";

type BigButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  icon?: ReactNode;
};

/** 48px+ tap target, high contrast. */
export function BigButton({ variant = "primary", icon, className = "", children, ...rest }: BigButtonProps) {
  const styles = {
    primary: "bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110",
    secondary: "bg-[var(--surface-2)] text-[var(--fg)] border border-[var(--border)] hover:brightness-95",
    danger: "bg-[var(--danger)] text-white hover:brightness-110",
    ghost: "bg-transparent text-[var(--fg)] underline-offset-4 hover:underline",
  }[variant];
  return (
    <button
      type="button"
      className={`min-h-12 rounded-xl px-5 py-3 text-lg font-semibold inline-flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] ${styles} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
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

export function OfflineBanner({ lang = "en" }: { lang?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-[var(--warn)] text-black px-4 py-2 text-center text-sm font-medium">
      {t("offline.banner", lang)}
    </div>
  );
}

export function DemoBanner({ lang = "en", show }: { lang?: string; show: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-[var(--surface-2)] border-b border-[var(--border)] px-4 py-1 text-center text-xs text-[var(--muted)]">
      {t("demo.banner", lang)}
    </div>
  );
}

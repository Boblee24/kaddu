"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemoBanner, OfflineBanner, useLang } from "@sats/ui/lite";

const LangCtx = createContext<string>("en");
export const useAppLang = () => useContext(LangCtx);

const NAV = [
  { href: "/scoreboard", label: "Scores" },
  { href: "/wallet", label: "⚡ Wallet" },
];

export function Shell({ children, demo }: { children: ReactNode; demo: boolean; nonce?: string }) {
  const [lang, setLang] = useLang("en");
  const path = usePathname();
  const wide = path.startsWith("/sponsor") || path.startsWith("/scoreboard");

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <LangCtx.Provider value={lang}>
      <div className="adire selvedge" aria-hidden />
      <DemoBanner show={demo} lang={lang} />
      <OfflineBanner lang={lang} />
      <header className={`mx-auto flex ${wide ? "max-w-3xl" : "max-w-md"} items-center justify-between gap-2 px-4 py-2`}>
        <Link href="/" className="font-display -ml-1 flex min-h-12 items-center px-1 text-[1.65rem] leading-none">
          Kàddu
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={path === n.href ? "page" : undefined}
              className="flex min-h-12 items-center whitespace-nowrap rounded-full px-2.5 text-base font-semibold aria-[current=page]:bg-[var(--surface-2)]"
            >
              {n.label}
            </Link>
          ))}
          <label className="flex min-h-12 items-center">
            <span className="sr-only">App language</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="min-h-10 rounded-full border-2 border-[var(--border)] bg-[var(--surface)] px-2 text-sm font-semibold"
            >
              <option value="en">EN</option>
              <option value="pcm">Pidgin</option>
              <option value="fr">FR</option>
            </select>
          </label>
        </nav>
      </header>
      <main className={`mx-auto flex ${wide ? "max-w-3xl" : "max-w-md"} flex-col gap-6 px-4 pb-16`}>{children}</main>
    </LangCtx.Provider>
  );
}

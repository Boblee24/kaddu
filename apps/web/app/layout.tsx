import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import { headers } from "next/headers";
import { Shell } from "./shell";
import "./globals.css";

// One display weight, self-hosted by next/font at build time (font-src 'self'; ~20 KB woff2, headings only).
const display = Fraunces({ subsets: ["latin"], weight: "700", display: "swap", variable: "--font-display" });

export const metadata: Metadata = {
  title: "Kàddu",
  description: "Fix AI transcripts of Wolof, Yorùbá and Pidgin. Get paid in sats.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e2a78",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers makes every page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const demo = process.env.DEMO_MODE === "1";
  return (
    <html lang="en" className={display.variable}>
      <body className="min-h-dvh">
        <Shell demo={demo} nonce={nonce}>
          {children}
        </Shell>
      </body>
    </html>
  );
}

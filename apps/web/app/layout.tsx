import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Shell } from "./shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kàddu",
  description: "Fix AI transcripts of Wolof, Yorùbá and Pidgin. Get paid in sats.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7931a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers makes every page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const demo = process.env.DEMO_MODE === "1";
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Shell demo={demo} nonce={nonce}>
          {children}
        </Shell>
      </body>
    </html>
  );
}

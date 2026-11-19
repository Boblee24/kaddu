/**
 * Connect to an NWC wallet with one retry. The first request on a fresh connection often has to
 * open the relay websocket and wait for the wallet service to wake up, so it can time out even when
 * the string is fine (users saw "fails first time, works on the second click"). We retry once with a
 * fresh client and a longer timeout. Definitive answers from the wallet (bad auth etc.) don't retry.
 */
import { createWallet } from "./wallet";
import type { Wallet, WalletInfo } from "./types";

const NO_RETRY = new Set(["UNAUTHORIZED", "RESTRICTED", "NOT_IMPLEMENTED", "INVALID_NWC_URL"]);

export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  constructor() {
    super("timeout");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new TimeoutError()), ms)))]).finally(() => clearTimeout(t));
}

const codeOf = (err: unknown) => (err && typeof err === "object" ? (err as { code?: unknown }).code : undefined);

export async function connectWallet(
  nwcUrl: string,
  o: { timeoutsMs?: number[]; create?: (url: string) => Wallet; onRetry?: (attempt: number) => void } = {},
): Promise<{ wallet: Wallet; info: WalletInfo; attempts: number }> {
  const timeouts = o.timeoutsMs ?? [15_000, 30_000];
  const create = o.create ?? createWallet;
  let last: unknown;
  for (let i = 0; i < timeouts.length; i++) {
    if (i > 0) o.onRetry?.(i + 1);
    let w: Wallet;
    try {
      w = create(nwcUrl);
    } catch (err) {
      throw err; // malformed string: retrying won't help
    }
    try {
      const info = await withTimeout(w.info(), timeouts[i]!);
      return { wallet: w, info, attempts: i + 1 };
    } catch (err) {
      w.close();
      last = err;
      const code = codeOf(err);
      if (typeof code === "string" && NO_RETRY.has(code)) break;
    }
  }
  throw last;
}

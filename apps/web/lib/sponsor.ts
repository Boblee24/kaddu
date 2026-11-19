import { requireEnv, serverEnv } from "@sats/core/env";
import { connectWallet, type Wallet } from "@sats/lightning";
import { checkSponsor, type ClaimLimits } from "@sats/payouts";

let sponsor: Wallet | undefined;
let network: string | undefined;

/** Sponsor wallet from SPONSOR_NWC_URL (server env only). One connection per server instance. */
export async function getSponsor(): Promise<{ wallet: Wallet; limits: ClaimLimits }> {
  if (!sponsor) {
    // connectWallet retries once on a slow first relay connection. If both attempts fail, nothing is
    // cached, so the next request tries again instead of reusing a dead client.
    const { wallet } = await connectWallet(requireEnv("SPONSOR_NWC_URL"));
    // Logs a warning if the connection can do more than pay (it should be pay_invoice-only in production).
    network = (await checkSponsor(wallet)).network;
    sponsor = wallet;
  }
  const env = serverEnv();
  return { wallet: sponsor, limits: { maxClaimSats: env.MAX_CLAIM_SATS, maxDailySats: env.MAX_DAILY_PAYOUT_SATS, network } };
}

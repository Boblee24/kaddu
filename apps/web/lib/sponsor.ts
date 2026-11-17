import { requireEnv, serverEnv } from "@sats/core/env";
import { createWallet, type Wallet } from "@sats/lightning";
import { checkSponsor, type ClaimLimits } from "@sats/payouts";

let sponsor: Wallet | undefined;
let network: string | undefined;

/** Sponsor wallet from SPONSOR_NWC_URL (server env only). One connection per server instance. */
export async function getSponsor(): Promise<{ wallet: Wallet; limits: ClaimLimits }> {
  if (!sponsor) {
    sponsor = createWallet(requireEnv("SPONSOR_NWC_URL"));
    // Logs a warning if the connection can do more than pay (it should be pay_invoice-only in production).
    network = (await checkSponsor(sponsor)).network;
  }
  const env = serverEnv();
  return { wallet: sponsor, limits: { maxClaimSats: env.MAX_CLAIM_SATS, maxDailySats: env.MAX_DAILY_PAYOUT_SATS, network } };
}

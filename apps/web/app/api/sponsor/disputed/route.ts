import { getDb } from "@/lib/db";
import { disputedClips } from "@/lib/sponsorOps";
import { requireAdmin } from "@/lib/adminRoute";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return json({ ok: true, clips: await disputedClips(getDb()) });
}

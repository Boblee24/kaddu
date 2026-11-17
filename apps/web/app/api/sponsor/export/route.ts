import { getDb } from "@/lib/db";
import { exportJsonl } from "@/lib/sponsorOps";
import { requireAdmin } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return new Response(await exportJsonl(getDb()), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": "attachment; filename=kaddu-dataset.jsonl",
      "cache-control": "no-store",
    },
  });
}

import { log } from "@sats/core/log";
import { getDb } from "@/lib/db";
import { uploadClip } from "@/lib/sponsorOps";
import { MAX_CLIP_BYTES } from "@/lib/seed";
import { requireAdmin } from "@/lib/adminRoute";
import { json, rateLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

/** multipart/form-data: file, id, lang, truth_text?, is_gold ("0" | "1"). */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const limited = rateLimited(req, "sponsor-upload", 30, 0.5);
  if (limited) return limited;
  if (Number(req.headers.get("content-length") ?? "0") > MAX_CLIP_BYTES + 8192) return json({ ok: false, code: "TOO_LARGE" }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, code: "BAD_FIELDS" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, code: "BAD_FIELDS" }, 400);
  if (file.size > MAX_CLIP_BYTES) return json({ ok: false, code: "TOO_LARGE" }, 413);
  const fields = Object.fromEntries(["id", "lang", "truth_text", "is_gold"].map((k) => [k, form.get(k) ?? undefined]));
  const r = await uploadClip(getDb(), { fields, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  log.info("sponsor.upload", { status: r.ok ? "ok" : "rejected", code: r.ok ? "none" : r.code });
  // Drafting runs in the batch job (pnpm drafts), not inline: the clip is served with an empty draft until then.
  return json(r, r.ok ? 200 : 400);
}

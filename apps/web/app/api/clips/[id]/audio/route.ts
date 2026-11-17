import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clips } from "@/lib/db/schema";
import { ClipId } from "@/lib/protocol";

export const dynamic = "force-dynamic";

/** Clip audio. Immutable per id, so cache hard (clips are ~10–15 KB; this matters on 3G). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = ClipId.safeParse((await params).id);
  if (!id.success) return new Response("bad id", { status: 400 });
  const [row] = await getDb().select({ audio: clips.audio, mime: clips.audioMime }).from(clips).where(eq(clips.id, id.data));
  if (!row) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(row.audio), {
    headers: {
      "content-type": row.mime,
      "content-length": String(row.audio.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

import { ADMIN_COOKIE } from "@/lib/admin";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = json({ ok: true });
  res.headers.append("set-cookie", `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}

import { NextResponse } from "next/server";
import { clientKey, createRateLimiter } from "@sats/core/rateLimit";

const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

/** Per-client token bucket per route. Returns a 429 response when over the limit, else null. */
export function rateLimited(req: Request, scope: string, capacity: number, refillPerSec: number): NextResponse | null {
  let l = limiters.get(scope);
  if (!l) limiters.set(scope, (l = createRateLimiter({ capacity, refillPerSec })));
  const r = l.take(clientKey(req.headers, scope));
  if (r.ok) return null;
  return NextResponse.json(
    { ok: false, code: "RATE_LIMITED" },
    { status: 429, headers: { "retry-after": String(Math.ceil(r.retryAfterMs / 1000)) } },
  );
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

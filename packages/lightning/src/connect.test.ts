import { describe, expect, it } from "vitest";
import { connectWallet } from "./connect";
import type { Wallet } from "./types";

function fakeFactory(behaviours: Array<"hang" | "ok" | "unauthorized">) {
  let n = 0;
  const closed: number[] = [];
  const create = () => {
    const idx = n++;
    const b = behaviours[idx] ?? "ok";
    return {
      info: () =>
        b === "ok"
          ? Promise.resolve({ methods: ["get_info"], notifications: [] })
          : b === "hang"
            ? new Promise(() => {})
            : Promise.reject(Object.assign(new Error("x"), { code: "UNAUTHORIZED" })),
      close: () => closed.push(idx),
    } as unknown as Wallet;
  };
  return { create, closed, count: () => n };
}

describe("connectWallet", () => {
  it("connects first time when the wallet answers", async () => {
    const f = fakeFactory(["ok"]);
    const r = await connectWallet("x", { create: f.create, timeoutsMs: [50, 100] });
    expect(r.attempts).toBe(1);
    expect(f.closed).toEqual([]);
  });

  it("retries once with a fresh client after a slow first connection", async () => {
    const f = fakeFactory(["hang", "ok"]);
    const retries: number[] = [];
    const r = await connectWallet("x", { create: f.create, timeoutsMs: [30, 100], onRetry: (a) => retries.push(a) });
    expect(r.attempts).toBe(2);
    expect(f.closed).toEqual([0]); // the stuck client was closed
    expect(retries).toEqual([2]);
  });

  it("gives up after the last attempt with a TIMEOUT code", async () => {
    const f = fakeFactory(["hang", "hang"]);
    await expect(connectWallet("x", { create: f.create, timeoutsMs: [20, 20] })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(f.count()).toBe(2);
  });

  it("does not retry a definitive wallet error", async () => {
    const f = fakeFactory(["unauthorized", "ok"]);
    await expect(connectWallet("x", { create: f.create, timeoutsMs: [50, 50] })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(f.count()).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import {
  AnonymousSessionCoordinationError,
  withAnonymousSessionLock,
} from "./anonymous-session-coordinator";

describe("Auth session tab coordination", () => {
  it("uses one exclusive Web Lock for the complete protected operation", async () => {
    const order: string[] = [];
    const locks = {
      async request<T>(
        name: string,
        options: { mode: "exclusive" },
        callback: () => Promise<T>,
      ): Promise<T> {
        order.push(`lock:${name}:${options.mode}`);
        const value = await callback();
        order.push("unlock");
        return value;
      },
    };

    await expect(
      withAnonymousSessionLock(
        async () => {
          order.push("verify-cookie");
          order.push("owner-mutation");
          return true;
        },
        { locks },
      ),
    ).resolves.toBe(true);

    expect(order).toEqual([
      "lock:emanowa:auth-session:v1:exclusive",
      "verify-cookie",
      "owner-mutation",
      "unlock",
    ]);
  });

  it("fails closed instead of inventing a non-atomic storage lease", async () => {
    await expect(
      withAnonymousSessionLock(async () => "must-not-run", { locks: null }),
    ).rejects.toBeInstanceOf(AnonymousSessionCoordinationError);
  });

  it("releases the Web Lock after a rejected protected operation", async () => {
    let active = false;
    const locks = {
      async request<T>(
        _name: string,
        _options: { mode: "exclusive" },
        callback: () => Promise<T>,
      ): Promise<T> {
        if (active) throw new Error("overlap");
        active = true;
        try {
          return await callback();
        } finally {
          active = false;
        }
      },
    };

    await expect(
      withAnonymousSessionLock(
        async () => {
          throw new Error("network failed");
        },
        { locks },
      ),
    ).rejects.toThrow("network failed");
    await expect(
      withAnonymousSessionLock(async () => "retried", { locks }),
    ).resolves.toBe("retried");
  });
});

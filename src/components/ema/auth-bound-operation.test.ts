import { describe, expect, it } from "vitest";

import {
  AuthBoundRequestCoordinator,
  AuthContextChangedError,
  assertStableAuthContextEpoch,
  captureStableAuthContextEpoch,
  interruptedMutationResolution,
} from "./auth-bound-operation";

describe("private request generation guard", () => {
  it("aborts and rejects an in-flight response after an Auth change", () => {
    const coordinator = new AuthBoundRequestCoordinator();
    const request = coordinator.start();

    coordinator.invalidate();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
    expect(() => request.assertCurrent()).toThrow(AuthContextChangedError);
  });

  it("lets a newer private request supersede an older response", () => {
    const coordinator = new AuthBoundRequestCoordinator();
    const older = coordinator.start();
    const newer = coordinator.start();

    expect(older.signal.aborted).toBe(true);
    expect(() => older.assertCurrent()).toThrow(AuthContextChangedError);
    expect(newer.isCurrent()).toBe(true);
    expect(() => newer.assertCurrent()).not.toThrow();
  });

  it("finishing a request does not invalidate its already-checked result", () => {
    const coordinator = new AuthBoundRequestCoordinator();
    const request = coordinator.start();

    request.assertCurrent();
    request.finish();

    expect(request.signal.aborted).toBe(false);
    expect(request.isCurrent()).toBe(true);
  });

  it("captures and rechecks the durable Auth epoch", () => {
    const epoch = "11111111-1111-4111-8111-111111111111";

    expect(captureStableAuthContextEpoch({ phase: "committed", epoch })).toBe(
      epoch,
    );
    expect(() =>
      assertStableAuthContextEpoch(epoch, { phase: "cancelled", epoch }),
    ).not.toThrow();
    expect(() =>
      assertStableAuthContextEpoch(epoch, {
        phase: "committed",
        epoch: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow(AuthContextChangedError);
  });

  it("rejects a private response while an Auth transition is pending", () => {
    expect(() =>
      captureStableAuthContextEpoch({ phase: "pending", epoch: null }),
    ).toThrow(AuthContextChangedError);
    expect(() =>
      assertStableAuthContextEpoch(null, { phase: "pending", epoch: null }),
    ).toThrow(AuthContextChangedError);
  });

  it("requires receipt replay for an interrupted mutation regardless of GET version", () => {
    const expected = { publicId: "ema-a", version: 4 };

    expect(interruptedMutationResolution(expected, expected)).toBe("replay");
    expect(
      interruptedMutationResolution(expected, {
        publicId: "ema-a",
        version: 5,
      }),
    ).toBe("replay");
    expect(
      interruptedMutationResolution(expected, {
        publicId: "ema-b",
        version: 1,
      }),
    ).toBe("resolved");
  });
});

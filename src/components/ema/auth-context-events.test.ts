import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authContextEventKeyForTests,
  beginAuthContextChange,
  cancelAuthContextChange,
  commitAuthContextChange,
  forceCommitPendingAuthContextChange,
  readAuthContextEpoch,
  readAuthContextSnapshot,
  runAuthContextChange,
  subscribeToAuthContextChanges,
} from "./auth-context-events";

const UUID_V4_FOR_TEST =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class CancelFailingStorage extends MemoryStorage {
  override setItem(key: string, value: string): void {
    if (value.includes('"phase":"cancelled"')) {
      throw new Error("cancel write failed");
    }
    super.setItem(key, value);
  }
}

class CommitFailingStorage extends MemoryStorage {
  override setItem(key: string, value: string): void {
    if (value.includes('"phase":"committed"')) {
      throw new Error("commit write failed");
    }
    super.setItem(key, value);
  }
}

afterEach(() => vi.unstubAllGlobals());

function browser(storage: MemoryStorage) {
  const windowListeners = new Map<string, Array<(event: unknown) => void>>();
  const documentListeners = new Map<string, Array<() => void>>();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      windowListeners.set(name, [
        ...(windowListeners.get(name) ?? []),
        listener,
      ]);
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: (name: string, listener: () => void) => {
      documentListeners.set(name, [
        ...(documentListeners.get(name) ?? []),
        listener,
      ]);
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("BroadcastChannel", undefined);
  return { windowListeners, documentListeners };
}

describe("two-phase Auth context events", () => {
  it("advances the opaque epoch only when a prepared change commits", () => {
    const storage = new MemoryStorage();
    browser(storage);

    const prepared = beginAuthContextChange("recover");
    expect(prepared).not.toBeNull();
    expect(readAuthContextSnapshot()).toMatchObject({
      phase: "pending",
      epoch: null,
      reason: "recover",
    });
    expect(readAuthContextEpoch()).toBeNull();

    expect(commitAuthContextChange(prepared!)).toBe(true);
    expect(readAuthContextSnapshot()).toMatchObject({
      phase: "committed",
      epoch: prepared!.transitionId,
    });
    expect(readAuthContextEpoch()).toBe(prepared!.transitionId);

    const raw = storage.getItem(authContextEventKeyForTests);
    expect(String(raw)).not.toMatch(/email|token|uid|wish/iu);
  });

  it("cancels without changing the epoch or deleting the retained draft context", () => {
    const storage = new MemoryStorage();
    browser(storage);
    const first = beginAuthContextChange("recover")!;
    commitAuthContextChange(first);
    const existingEpoch = readAuthContextEpoch();

    const attempted = beginAuthContextChange("signout")!;
    expect(cancelAuthContextChange(attempted)).toBe(true);

    expect(readAuthContextSnapshot()).toMatchObject({
      phase: "cancelled",
      epoch: existingEpoch,
      reason: "signout",
    });
  });

  it("commits only a successful Auth result and cancels failed or rejected work", async () => {
    const storage = new MemoryStorage();
    browser(storage);

    await expect(
      runAuthContextChange("recover", async () => ({ ok: false })),
    ).resolves.toEqual({ ok: false });
    expect(readAuthContextSnapshot().phase).toBe("cancelled");
    expect(readAuthContextEpoch()).toBeNull();

    await expect(
      runAuthContextChange(
        "link",
        async () => ({ ok: true, contextChanged: false }),
        (result) => result.contextChanged,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(readAuthContextSnapshot().phase).toBe("cancelled");
    expect(readAuthContextEpoch()).toBeNull();

    await expect(
      runAuthContextChange("signout", async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(readAuthContextSnapshot().phase).toBe("cancelled");
    expect(readAuthContextEpoch()).toBeNull();

    await expect(
      runAuthContextChange("recover", async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
    expect(readAuthContextSnapshot().phase).toBe("committed");
    expect(readAuthContextEpoch()).toMatch(UUID_V4_FOR_TEST);
  });

  it("fails before the Auth request when durable pending storage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    vi.stubGlobal("BroadcastChannel", class {});

    expect(beginAuthContextChange("recover")).toBeNull();
  });

  it("leaves pending fail-private when cancellation cannot be persisted", async () => {
    const storage = new CancelFailingStorage();
    browser(storage);

    await expect(
      runAuthContextChange("recover", async () => ({ ok: false })),
    ).rejects.toBeInstanceOf(Error);
    expect(readAuthContextSnapshot().phase).toBe("pending");

    await expect(
      runAuthContextChange("signout", async () => ({ ok: true })),
    ).rejects.toMatchObject({ identityChanged: false });
    expect(readAuthContextSnapshot().phase).toBe("pending");
  });

  it("leaves pending and reports an identity change when commit cannot be persisted", async () => {
    const storage = new CommitFailingStorage();
    browser(storage);

    await expect(
      runAuthContextChange("recover", async () => ({ ok: true })),
    ).rejects.toMatchObject({ identityChanged: true });
    expect(readAuthContextSnapshot().phase).toBe("pending");
    expect(readAuthContextEpoch()).toBeNull();
  });

  it("can explicitly fail-private a pending marker stranded by a tab crash", () => {
    const storage = new MemoryStorage();
    browser(storage);
    const prepared = beginAuthContextChange("recover")!;

    expect(forceCommitPendingAuthContextChange()).toMatchObject({
      phase: "committed",
      epoch: prepared.transitionId,
    });
    expect(readAuthContextEpoch()).toBe(prepared.transitionId);
  });

  it("accepts each phase from another tab once and ignores malformed events", () => {
    const storage = new MemoryStorage();
    const { windowListeners } = browser(storage);
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthContextChanges(listener);
    const transitionId = "123e4567-e89b-42d3-a456-426614174000";
    const source = "223e4567-e89b-42d3-a456-426614174000";
    const pending = JSON.stringify({
      version: 2,
      source,
      transitionId,
      epoch: null,
      phase: "pending",
      reason: "signout",
    });
    const committed = JSON.stringify({
      version: 2,
      source,
      transitionId,
      epoch: transitionId,
      phase: "committed",
      reason: "signout",
    });
    const cancelledTransitionId = "523e4567-e89b-42d3-a456-426614174000";
    const cancelledPending = JSON.stringify({
      version: 2,
      source,
      transitionId: cancelledTransitionId,
      epoch: transitionId,
      phase: "pending",
      reason: "recover",
    });
    const cancelled = JSON.stringify({
      version: 2,
      source,
      transitionId: cancelledTransitionId,
      epoch: transitionId,
      phase: "cancelled",
      reason: "recover",
    });
    const dispatch = (newValue: string) =>
      windowListeners.get("storage")?.[0]?.({
        key: authContextEventKeyForTests,
        newValue,
      });

    dispatch("bad");
    dispatch(pending);
    dispatch(pending);
    dispatch(committed);
    dispatch(cancelledPending);
    dispatch(cancelled);

    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: "pending", epoch: null }),
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: "committed",
        epoch: transitionId,
      }),
    );
    expect(listener).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        phase: "cancelled",
        epoch: transitionId,
      }),
    );
    unsubscribe();
  });

  it("reconciles a missed durable phase when the tab regains focus", () => {
    const storage = new MemoryStorage();
    const { windowListeners } = browser(storage);
    const listener = vi.fn();
    subscribeToAuthContextChanges(listener);
    storage.setItem(
      authContextEventKeyForTests,
      JSON.stringify({
        version: 2,
        source: "323e4567-e89b-42d3-a456-426614174000",
        transitionId: "423e4567-e89b-42d3-a456-426614174000",
        epoch: null,
        phase: "pending",
        reason: "recover",
      }),
    );

    windowListeners.get("focus")?.[0]?.({});

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "pending", reason: "recover" }),
    );
  });
});

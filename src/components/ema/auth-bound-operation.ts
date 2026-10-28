export class AuthContextChangedError extends Error {
  constructor() {
    super("認証状態が変わったため、古い応答を破棄しました。");
    this.name = "AuthContextChangedError";
  }
}

export type AuthBoundOperation = {
  readonly signal: AbortSignal;
  assertCurrent(): void;
  isCurrent(): boolean;
  finish(): void;
};

export type AuthContextEpochSnapshot = {
  readonly epoch: string | null;
  readonly phase: string;
};

export function captureStableAuthContextEpoch(
  snapshot: AuthContextEpochSnapshot,
): string | null {
  if (snapshot.phase === "pending") throw new AuthContextChangedError();
  return snapshot.epoch;
}

export function assertStableAuthContextEpoch(
  expectedEpoch: string | null,
  snapshot: AuthContextEpochSnapshot,
): void {
  if (snapshot.phase === "pending" || snapshot.epoch !== expectedEpoch) {
    throw new AuthContextChangedError();
  }
}

type OwnerVersionIdentity = {
  readonly publicId: string;
  readonly version: number;
};

export function interruptedMutationResolution(
  expected: OwnerVersionIdentity,
  current: OwnerVersionIdentity,
): "replay" | "resolved" {
  return expected.publicId === current.publicId ? "replay" : "resolved";
}

/**
 * Gives every private request a generation and sequence. An Auth change
 * invalidates and aborts in-flight work, while a newer request supersedes an
 * older response from the same identity.
 */
export class AuthBoundRequestCoordinator {
  private generation = 0;
  private sequence = 0;
  private activeController: AbortController | null = null;

  start(): AuthBoundOperation {
    this.activeController?.abort();
    const controller = new AbortController();
    const generation = this.generation;
    const sequence = ++this.sequence;
    this.activeController = controller;

    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      generation === this.generation &&
      sequence === this.sequence;

    return {
      signal: controller.signal,
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new AuthContextChangedError();
      },
      finish: () => {
        if (this.activeController === controller) {
          this.activeController = null;
        }
      },
    };
  }

  invalidate(): void {
    this.generation += 1;
    this.sequence += 1;
    this.activeController?.abort();
    this.activeController = null;
  }
}

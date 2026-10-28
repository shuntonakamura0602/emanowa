const WEB_LOCK_NAME = "emanowa:auth-session:v1";

type ExclusiveLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
};

export type AnonymousSessionCoordinatorOptions = {
  /** Test seam. Omit to use navigator.locks; null explicitly disables it. */
  locks?: ExclusiveLockManager | null;
};

export class AnonymousSessionCoordinationError extends Error {
  constructor(message = "認証状態をタブ間で安全に調整できませんでした。") {
    super(message);
    this.name = "AnonymousSessionCoordinationError";
  }
}

function discoverLocks(): ExclusiveLockManager | null {
  if (typeof navigator === "undefined" || !navigator.locks) return null;
  return navigator.locks as unknown as ExclusiveLockManager;
}

/**
 * Serializes identity-changing Auth work and owner mutations across tabs that
 * share cookies. Web Locks is the only safe client-side primitive here:
 * localStorage has no compare-and-swap, so an improvised lease can admit two
 * contenders after a suspended tab resumes. Unsupported browsers fail closed.
 */
export async function withAnonymousSessionLock<T>(
  task: () => Promise<T>,
  overrides: AnonymousSessionCoordinatorOptions = {},
): Promise<T> {
  const locks =
    "locks" in overrides ? (overrides.locks ?? null) : discoverLocks();
  if (!locks) throw new AnonymousSessionCoordinationError();
  return locks.request(WEB_LOCK_NAME, { mode: "exclusive" }, task);
}

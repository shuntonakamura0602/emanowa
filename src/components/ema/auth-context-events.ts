const AUTH_CONTEXT_EVENT_KEY = "emanowa:auth-context-change:v2";
const AUTH_CONTEXT_CHANNEL = "emanowa:auth-context:v2";

export type AuthContextChangeReason = "link" | "recover" | "signout";
export type AuthContextTransitionPhase = "pending" | "committed" | "cancelled";

type AuthContextEvent = {
  version: 2;
  source: string;
  transitionId: string;
  epoch: string | null;
  phase: AuthContextTransitionPhase;
  reason: AuthContextChangeReason;
};

export type AuthContextChange = Pick<
  AuthContextEvent,
  "transitionId" | "epoch" | "phase" | "reason"
>;

export type PreparedAuthContextChange = {
  readonly source: string;
  readonly transitionId: string;
  readonly previousEpoch: string | null;
  readonly reason: AuthContextChangeReason;
};

export type AuthContextSnapshot =
  | AuthContextChange
  | {
      transitionId: null;
      epoch: null;
      phase: "idle";
      reason: null;
    };

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

let currentTabId: string | null = null;

function tabId(): string {
  currentTabId ??= globalThis.crypto.randomUUID();
  return currentTabId;
}

function parseEvent(value: unknown): AuthContextEvent | null {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const event = candidate as Partial<AuthContextEvent>;
  if (
    event.version !== 2 ||
    typeof event.source !== "string" ||
    !UUID_V4.test(event.source) ||
    typeof event.transitionId !== "string" ||
    !UUID_V4.test(event.transitionId) ||
    (event.epoch !== null &&
      (typeof event.epoch !== "string" || !UUID_V4.test(event.epoch))) ||
    (event.phase !== "pending" &&
      event.phase !== "committed" &&
      event.phase !== "cancelled") ||
    (event.reason !== "link" &&
      event.reason !== "recover" &&
      event.reason !== "signout")
  ) {
    return null;
  }
  return event as AuthContextEvent;
}

function latestEvent(): AuthContextEvent | null {
  if (typeof window === "undefined") return null;
  try {
    return parseEvent(window.localStorage.getItem(AUTH_CONTEXT_EVENT_KEY));
  } catch {
    return null;
  }
}

function signature(event: AuthContextEvent): string {
  return `${event.transitionId}:${event.phase}`;
}

function publicChange(event: AuthContextEvent): AuthContextChange {
  return {
    transitionId: event.transitionId,
    epoch: event.epoch,
    phase: event.phase,
    reason: event.reason,
  };
}

function writeEvent(event: AuthContextEvent): boolean {
  if (typeof window === "undefined") return false;
  const serialized = JSON.stringify(event);
  try {
    window.localStorage.setItem(AUTH_CONTEXT_EVENT_KEY, serialized);
    if (window.localStorage.getItem(AUTH_CONTEXT_EVENT_KEY) !== serialized) {
      return false;
    }
  } catch {
    return false;
  }

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(AUTH_CONTEXT_CHANNEL);
      channel.postMessage(event);
      channel.close();
    } catch {
      // Durable storage and focus reconciliation remain authoritative.
    }
  }
  return true;
}

export function readAuthContextSnapshot(): AuthContextSnapshot {
  const event = latestEvent();
  return event
    ? publicChange(event)
    : { transitionId: null, epoch: null, phase: "idle", reason: null };
}

export function readAuthContextEpoch(): string | null {
  return readAuthContextSnapshot().epoch;
}

/**
 * Persists a pending marker before an identity-changing request. Other tabs
 * hide private state but retain drafts until this transition is committed or
 * cancelled. A stranded pending marker therefore fails private.
 */
export function beginAuthContextChange(
  reason: AuthContextChangeReason,
): PreparedAuthContextChange | null {
  const latest = latestEvent();
  if (latest?.phase === "pending") return null;
  const prepared: PreparedAuthContextChange = {
    source: tabId(),
    transitionId: globalThis.crypto.randomUUID(),
    previousEpoch: latest?.epoch ?? null,
    reason,
  };
  return writeEvent({
    version: 2,
    source: prepared.source,
    transitionId: prepared.transitionId,
    epoch: prepared.previousEpoch,
    phase: "pending",
    reason,
  })
    ? prepared
    : null;
}

function finishAuthContextChange(
  prepared: PreparedAuthContextChange,
  phase: "committed" | "cancelled",
): boolean {
  const latest = latestEvent();
  if (
    !latest ||
    latest.phase !== "pending" ||
    latest.source !== prepared.source ||
    latest.transitionId !== prepared.transitionId ||
    latest.reason !== prepared.reason
  ) {
    return false;
  }
  return writeEvent({
    version: 2,
    source: prepared.source,
    transitionId: prepared.transitionId,
    epoch:
      phase === "committed" ? prepared.transitionId : prepared.previousEpoch,
    phase,
    reason: prepared.reason,
  });
}

export function commitAuthContextChange(
  prepared: PreparedAuthContextChange,
): boolean {
  return finishAuthContextChange(prepared, "committed");
}

export function cancelAuthContextChange(
  prepared: PreparedAuthContextChange,
): boolean {
  return finishAuthContextChange(prepared, "cancelled");
}

/** Explicit recovery for a tab crash that stranded a pending marker. This
 * chooses confidentiality over restoring an identity-bound draft. */
export function forceCommitPendingAuthContextChange(): AuthContextChange | null {
  const latest = latestEvent();
  if (!latest || latest.phase !== "pending") return null;
  const committed: AuthContextEvent = {
    ...latest,
    source: tabId(),
    epoch: latest.transitionId,
    phase: "committed",
  };
  return writeEvent(committed) ? publicChange(committed) : null;
}

export class AuthContextTransitionError extends Error {
  constructor(
    message: string,
    readonly identityChanged: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthContextTransitionError";
  }
}

/** Runs an identity-changing request between a durable pending marker and a
 * committed/cancelled marker. A failed commit intentionally leaves pending in
 * place so every other tab stays fail-private. */
export async function runAuthContextChange<T extends { ok: boolean }>(
  reason: AuthContextChangeReason,
  task: () => Promise<T>,
  didChange: (result: T) => boolean = (result) => result.ok,
): Promise<T> {
  const prepared = beginAuthContextChange(reason);
  if (!prepared) {
    throw new AuthContextTransitionError(
      "認証変更をタブ間で安全に開始できませんでした。",
      false,
    );
  }

  let identityChanged = false;
  try {
    const result = await task();
    if (didChange(result)) {
      identityChanged = true;
      if (!commitAuthContextChange(prepared)) {
        throw new AuthContextTransitionError(
          "認証変更後の安全な確定通知に失敗しました。",
          true,
        );
      }
    } else if (!cancelAuthContextChange(prepared)) {
      throw new AuthContextTransitionError(
        "失敗した認証変更の取消通知に失敗しました。",
        false,
      );
    }
    return result;
  } catch (error) {
    if (identityChanged) throw error;
    if (!cancelAuthContextChange(prepared)) {
      throw new AuthContextTransitionError(
        "失敗した認証変更の取消通知に失敗しました。",
        false,
        { cause: error },
      );
    }
    throw error;
  }
}

export function subscribeToAuthContextChanges(
  listener: (change: AuthContextChange) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const initial = latestEvent();
  let lastSeenSignature = initial ? signature(initial) : null;

  const receive = (value: unknown): void => {
    const event = parseEvent(value);
    if (!event) return;
    const nextSignature = signature(event);
    if (nextSignature === lastSeenSignature) return;
    lastSeenSignature = nextSignature;
    if (event.source === tabId()) return;
    listener(publicChange(event));
  };

  const onStorage = (event: StorageEvent): void => {
    if (event.key === AUTH_CONTEXT_EVENT_KEY) receive(event.newValue);
  };
  const reconcileLatest = (): void => {
    const event = latestEvent();
    if (event && signature(event) !== lastSeenSignature) receive(event);
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") reconcileLatest();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", reconcileLatest);
  document.addEventListener("visibilitychange", onVisibility);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(AUTH_CONTEXT_CHANNEL);
      channel.addEventListener("message", (event) => receive(event.data));
    } catch {
      channel = null;
    }
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", reconcileLatest);
    document.removeEventListener("visibilitychange", onVisibility);
    channel?.close();
  };
}

export const authContextEventKeyForTests = AUTH_CONTEXT_EVENT_KEY;

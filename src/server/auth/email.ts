import type { ApiErrorCode } from "@/domain";
import type { EmailAuthClient } from "@/server/supabase/contracts";

type AuthErrorLike = {
  code?: unknown;
  status?: unknown;
};

const ACCOUNT_CONFLICT_CODES = new Set([
  "conflict",
  "email_exists",
  "identity_already_exists",
  "user_already_exists",
]);

const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

export class EmailAuthFlowError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly authContextChanged = false,
  ) {
    super(message);
    this.name = "EmailAuthFlowError";
  }
}

function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as AuthErrorLike).code;
  return typeof code === "string" ? code : null;
}

function authErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as AuthErrorLike).status;
  return typeof status === "number" ? status : null;
}

function isRateLimited(error: unknown): boolean {
  const code = authErrorCode(error);
  return (
    Boolean(code && RATE_LIMIT_CODES.has(code)) ||
    authErrorStatus(error) === 429
  );
}

function invalidOtp(authContextChanged = false): EmailAuthFlowError {
  return new EmailAuthFlowError(
    "INVALID_OTP",
    400,
    "確認コードが無効か、期限が切れています。",
    authContextChanged,
  );
}

async function requireAnonymousUser(client: EmailAuthClient) {
  const current = await client.auth.getUser();
  if (current.error || !current.data.user) {
    throw new EmailAuthFlowError(
      "AUTH_REQUIRED",
      401,
      "匿名セッションを確認できませんでした。",
    );
  }
  if (current.data.user.is_anonymous !== true) {
    throw new EmailAuthFlowError(
      "FORBIDDEN",
      403,
      "この操作は匿名セッションでのみ利用できます。",
    );
  }
  return current.data.user;
}

async function clearUnsafeSession(client: EmailAuthClient): Promise<boolean> {
  try {
    const result = await client.auth.signOut({ scope: "local" });
    return !result.error;
  } catch {
    return false;
  }
}

function unsafeSessionCleanupFailed(): EmailAuthFlowError {
  return new EmailAuthFlowError(
    "TEMPORARILY_UNAVAILABLE",
    503,
    "本人情報を安全に確認できませんでした。",
    true,
  );
}

export async function linkAnonymousEmail(
  client: EmailAuthClient,
  email: string,
): Promise<void> {
  const before = await requireAnonymousUser(client);
  const updated = await client.auth.updateUser({ email });

  if (updated.error) {
    const code = authErrorCode(updated.error);
    if (code && ACCOUNT_CONFLICT_CODES.has(code)) {
      throw new EmailAuthFlowError(
        "ACCOUNT_LINK_CONFLICT",
        409,
        "このメールアドレスは既存のアカウントに登録されています。",
      );
    }
    if (isRateLimited(updated.error)) {
      throw new EmailAuthFlowError(
        "RATE_LIMITED",
        429,
        "しばらく待ってからもう一度お試しください。",
      );
    }
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "メール連携を開始できませんでした。",
    );
  }

  if (!updated.data.user || updated.data.user.id !== before.id) {
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "メール連携を安全に開始できませんでした。",
    );
  }
}

/**
 * Account discovery must not be possible through this endpoint. Once a valid
 * request reaches Supabase Auth, callers always receive the same accepted
 * result, including for unknown addresses, provider errors, and rate limits.
 */
export async function requestEmailRecovery(
  client: EmailAuthClient,
  email: string,
  captchaToken?: string,
): Promise<void> {
  try {
    await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
  } catch {
    // Deliberately indistinguishable from an accepted request.
  }
}

async function verifyCurrentUser(
  client: EmailAuthClient,
  expectedUid: string,
): Promise<boolean> {
  try {
    const current = await client.auth.getUser();
    return Boolean(
      !current.error &&
      current.data.user &&
      current.data.user.id === expectedUid &&
      current.data.user.is_anonymous === false,
    );
  } catch {
    return false;
  }
}

export async function verifyEmailOtp(
  client: EmailAuthClient,
  input: { flow: "link" | "recover"; email: string; token: string },
): Promise<void> {
  const originalUid =
    input.flow === "link" ? (await requireAnonymousUser(client)).id : null;
  const verified = await client.auth.verifyOtp({
    email: input.email,
    token: input.token,
    type: input.flow === "link" ? "email_change" : "email",
  });

  if (verified.error) throw invalidOtp();

  const verifiedUid = verified.data.user?.id ?? verified.data.session?.user.id;
  if (!verifiedUid || (originalUid !== null && verifiedUid !== originalUid)) {
    if (!(await clearUnsafeSession(client))) {
      throw unsafeSessionCleanupFailed();
    }
    throw invalidOtp(true);
  }

  if (!(await verifyCurrentUser(client, verifiedUid))) {
    if (!(await clearUnsafeSession(client))) {
      throw unsafeSessionCleanupFailed();
    }
    throw invalidOtp(true);
  }
}

export async function signOutLocal(client: EmailAuthClient): Promise<void> {
  let result: Awaited<ReturnType<EmailAuthClient["auth"]["signOut"]>>;
  try {
    result = await client.auth.signOut({ scope: "local" });
  } catch {
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "この端末のセッションを終了できませんでした。",
      true,
    );
  }
  if (result.error) {
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "この端末のセッションを終了できませんでした。",
      true,
    );
  }
}

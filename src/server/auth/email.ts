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
const CAPTCHA_FAILURE_CODE = "captcha_failed";
const PROVIDER_RETRY_AFTER_SECONDS = 60;

type EmailAuthFlowErrorOptions = {
  authContextChanged?: boolean;
  fieldErrors?: Record<string, string>;
  otpRequestNotSent?: boolean;
  retryAfterSeconds?: number;
};

export class EmailAuthFlowError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    options: EmailAuthFlowErrorOptions = {},
  ) {
    super(message);
    this.name = "EmailAuthFlowError";
    this.authContextChanged = options.authContextChanged ?? false;
    this.fieldErrors = options.fieldErrors;
    this.otpRequestNotSent = options.otpRequestNotSent ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  readonly authContextChanged: boolean;
  readonly fieldErrors?: Record<string, string>;
  readonly otpRequestNotSent: boolean;
  readonly retryAfterSeconds?: number;
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
    { authContextChanged },
  );
}

function providerRateLimited(
  options: Pick<
    EmailAuthFlowErrorOptions,
    "authContextChanged" | "otpRequestNotSent"
  > = {},
): EmailAuthFlowError {
  return new EmailAuthFlowError(
    "RATE_LIMITED",
    429,
    "しばらく待ってからもう一度お試しください。",
    { ...options, retryAfterSeconds: PROVIDER_RETRY_AFTER_SECONDS },
  );
}

async function requireAnonymousUser(client: EmailAuthClient) {
  let current: Awaited<ReturnType<EmailAuthClient["auth"]["getUser"]>>;
  try {
    current = await client.auth.getUser();
  } catch (error) {
    if (isRateLimited(error)) throw providerRateLimited();
    throw error;
  }
  if (isRateLimited(current.error)) throw providerRateLimited();
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
    { authContextChanged: true },
  );
}

function invalidCaptcha(): EmailAuthFlowError {
  return new EmailAuthFlowError(
    "VALIDATION_ERROR",
    422,
    "入力内容を確認してください。",
    {
      fieldErrors: {
        captchaToken: "CAPTCHAの確認に失敗しました。もう一度お試しください。",
      },
      otpRequestNotSent: true,
    },
  );
}

export async function requireAnonymousEmailLinkSession(
  client: EmailAuthClient,
): Promise<string> {
  return (await requireAnonymousUser(client)).id;
}

export async function linkAnonymousEmail(
  client: EmailAuthClient,
  email: string,
  expectedUid: string,
): Promise<void> {
  const updated = await client.auth.updateUser({ email });

  if (updated.error) {
    const code = authErrorCode(updated.error);
    if (code && ACCOUNT_CONFLICT_CODES.has(code)) {
      throw new EmailAuthFlowError(
        "ACCOUNT_LINK_CONFLICT",
        409,
        "このメールアドレスは既存のアカウントに登録されています。",
        { otpRequestNotSent: true },
      );
    }
    if (isRateLimited(updated.error)) {
      throw providerRateLimited({ otpRequestNotSent: true });
    }
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "メール連携を開始できませんでした。",
    );
  }

  if (!updated.data.user || updated.data.user.id !== expectedUid) {
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "メール連携を安全に開始できませんでした。",
    );
  }
}

/**
 * Account discovery must not be possible through this endpoint. Once a valid
 * request reaches Supabase Auth, callers receive the same accepted result for
 * unknown addresses, provider errors, and provider rate limits. CAPTCHA
 * rejection is surfaced as a field error so a fresh challenge can be shown.
 */
export async function requestEmailRecovery(
  client: EmailAuthClient,
  email: string,
  captchaToken?: string,
): Promise<void> {
  try {
    const result = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    if (authErrorCode(result.error) === CAPTCHA_FAILURE_CODE) {
      throw invalidCaptcha();
    }
  } catch (error) {
    if (error instanceof EmailAuthFlowError) throw error;
    if (authErrorCode(error) === CAPTCHA_FAILURE_CODE) throw invalidCaptcha();
    // Deliberately indistinguishable from an accepted request.
  }
}

async function verifyCurrentUser(
  client: EmailAuthClient,
  expectedUid: string,
): Promise<"verified" | "unverified" | "rate_limited"> {
  try {
    const current = await client.auth.getUser();
    if (isRateLimited(current.error)) return "rate_limited";
    return Boolean(
      !current.error &&
      current.data.user &&
      current.data.user.id === expectedUid &&
      current.data.user.is_anonymous === false,
    )
      ? "verified"
      : "unverified";
  } catch (error) {
    return isRateLimited(error) ? "rate_limited" : "unverified";
  }
}

export async function verifyEmailOtp(
  client: EmailAuthClient,
  input: { flow: "link" | "recover"; email: string; token: string },
  expectedLinkUid?: string,
): Promise<void> {
  const originalUid =
    input.flow === "link"
      ? (expectedLinkUid ?? (await requireAnonymousUser(client)).id)
      : null;
  const verified = await client.auth.verifyOtp({
    email: input.email,
    token: input.token,
    type: input.flow === "link" ? "email_change" : "email",
  });

  if (verified.error) {
    if (isRateLimited(verified.error)) {
      throw providerRateLimited();
    }
    throw invalidOtp();
  }

  const verifiedUid = verified.data.user?.id ?? verified.data.session?.user.id;
  if (!verifiedUid || (originalUid !== null && verifiedUid !== originalUid)) {
    if (!(await clearUnsafeSession(client))) {
      throw unsafeSessionCleanupFailed();
    }
    throw invalidOtp(true);
  }

  const currentUserVerification = await verifyCurrentUser(client, verifiedUid);
  if (currentUserVerification !== "verified") {
    if (!(await clearUnsafeSession(client))) {
      throw unsafeSessionCleanupFailed();
    }
    if (currentUserVerification === "rate_limited") {
      throw providerRateLimited({ authContextChanged: true });
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
      { authContextChanged: true },
    );
  }
  if (result.error) {
    throw new EmailAuthFlowError(
      "TEMPORARILY_UNAVAILABLE",
      503,
      "この端末のセッションを終了できませんでした。",
      { authContextChanged: true },
    );
  }
}

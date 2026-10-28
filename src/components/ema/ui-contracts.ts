import {
  createEmaInputSchema,
  type ApiError,
  type ApiErrorCode,
  type Category,
  type CreateEmaInput,
  type MessageVisibility,
  type MutationReceipt,
  type Visibility,
} from "@/domain/schemas";
import { fromSlotNumber } from "@/domain/coordinates";

export const CATEGORY_OPTIONS: readonly {
  value: Category;
  label: string;
}[] = [
  { value: "family", label: "家族" },
  { value: "health", label: "健康" },
  { value: "study", label: "学び・合格" },
  { value: "work", label: "仕事" },
  { value: "love", label: "恋愛・ご縁" },
  { value: "challenge", label: "挑戦" },
  { value: "other", label: "その他" },
];

export type EmaDraft = {
  wishText: string;
  nickname: string;
  category: Category;
  visibility: Visibility;
  messageVisibility: MessageVisibility;
  slotNumber: string;
};

export type StoredEmaDraft = {
  version: 2;
  authContextEpoch: string | null;
  values: EmaDraft;
  idempotencyKey: string | null;
  idempotencyPayload: string | null;
};

export type FieldErrors = Partial<
  Record<keyof EmaDraft | "request" | "idempotencyKey", string>
>;

export const EMPTY_DRAFT: EmaDraft = {
  wishText: "",
  nickname: "",
  category: "other",
  visibility: "public",
  messageVisibility: "public",
  slotNumber: "",
};

export function draftStorageKey(worldSlug: string): string {
  return `emanowa:draft:v2:${worldSlug}`;
}

export function readStoredDraft(
  storage: Pick<Storage, "getItem">,
  key: string,
): StoredEmaDraft | null {
  try {
    return parseStoredDraft(storage.getItem(key));
  } catch {
    return null;
  }
}

export function readStoredDraftForAuthContext(
  storage: Pick<Storage, "getItem">,
  key: string,
  authContextEpoch: string | null,
): StoredEmaDraft | null {
  const stored = readStoredDraft(storage, key);
  return stored?.authContextEpoch === authContextEpoch ? stored : null;
}

export function writeStoredDraft(
  storage: Pick<Storage, "setItem">,
  key: string,
  value: StoredEmaDraft,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredDraft(
  storage: Pick<Storage, "removeItem">,
  key: string,
): void {
  try {
    storage.removeItem(key);
  } catch {
    // In-memory state is still cleared when session storage is unavailable.
  }
}

export function createInputFromDraft(draft: EmaDraft): {
  input: CreateEmaInput | null;
  fieldErrors: FieldErrors;
} {
  const slotNumber = Number(draft.slotNumber);
  if (!Number.isInteger(slotNumber)) {
    return {
      input: null,
      fieldErrors: { slotNumber: "1〜1,000,000の整数で指定してください。" },
    };
  }

  let coordinate: { x: number; y: number };
  try {
    coordinate = fromSlotNumber(slotNumber);
  } catch {
    return {
      input: null,
      fieldErrors: { slotNumber: "1〜1,000,000の範囲で指定してください。" },
    };
  }

  const parsed = createEmaInputSchema.safeParse({
    ...coordinate,
    wishText: draft.wishText,
    nickname: draft.nickname,
    category: draft.category,
    designId: "basic_wood",
    visibility: draft.visibility,
    messageVisibility: draft.messageVisibility,
  });

  if (parsed.success) {
    return { input: parsed.data, fieldErrors: {} };
  }

  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (
      key === "wishText" ||
      key === "nickname" ||
      key === "category" ||
      key === "visibility" ||
      key === "messageVisibility"
    ) {
      fieldErrors[key] ??= `${issue.message}。`;
    } else {
      fieldErrors.request ??= `${issue.message}。`;
    }
  }
  return { input: null, fieldErrors };
}

export function canonicalCreatePayload(input: CreateEmaInput): string {
  return JSON.stringify({
    x: input.x,
    y: input.y,
    wishText: input.wishText,
    nickname: input.nickname ?? null,
    category: input.category,
    designId: input.designId,
    visibility: input.visibility,
    messageVisibility: input.messageVisibility,
  });
}

export function parseStoredDraft(value: string | null): StoredEmaDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredEmaDraft>;
    if (
      parsed.version !== 2 ||
      !parsed.values ||
      (parsed.authContextEpoch !== null &&
        (typeof parsed.authContextEpoch !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            parsed.authContextEpoch,
          )))
    ) {
      return null;
    }
    const values = parsed.values as Partial<EmaDraft>;
    if (
      typeof values.wishText !== "string" ||
      typeof values.nickname !== "string" ||
      typeof values.slotNumber !== "string" ||
      !CATEGORY_OPTIONS.some((option) => option.value === values.category) ||
      (values.visibility !== "public" && values.visibility !== "unlisted") ||
      (values.messageVisibility !== "public" &&
        values.messageVisibility !== "owner_only")
    ) {
      return null;
    }
    return {
      version: 2,
      authContextEpoch: parsed.authContextEpoch,
      values: values as EmaDraft,
      idempotencyKey:
        typeof parsed.idempotencyKey === "string"
          ? parsed.idempotencyKey
          : null,
      idempotencyPayload:
        typeof parsed.idempotencyPayload === "string"
          ? parsed.idempotencyPayload
          : null,
    };
  } catch {
    return null;
  }
}

export function nearbySlotCandidates(slotNumber: number): number[] {
  let origin: { x: number; y: number };
  try {
    origin = fromSlotNumber(slotNumber);
  } catch {
    return [];
  }

  const candidates: number[] = [];
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const x = origin.x + dx;
    const y = origin.y + dy;
    if (x >= 0 && x < 1_000 && y >= 0 && y < 1_000) {
      candidates.push(y * 1_000 + x + 1);
    }
  }
  return candidates;
}

export function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string",
  );
}

export function isMutationReceipt(value: unknown): value is MutationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<MutationReceipt>;
  return (
    typeof receipt.publicId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      receipt.publicId,
    ) &&
    typeof receipt.worldSlug === "string" &&
    /^\d{4}$/u.test(receipt.worldSlug) &&
    typeof receipt.version === "number" &&
    Number.isInteger(receipt.version) &&
    receipt.version >= 1 &&
    (receipt.result === "created" ||
      receipt.result === "updated" ||
      receipt.result === "deleted") &&
    typeof receipt.canonicalUrl === "string"
  );
}

const ERROR_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  SLOT_TAKEN:
    "この場所には、先に絵馬が掛けられました。近くの空いている場所を選んでください。",
  OWNER_LIMIT_REACHED: "この年には、すでに絵馬を掛けています。",
  SESSION_EXPIRED: "編集できる状態を確認しています。",
  AUTH_REQUIRED: "編集できる状態を確認しています。",
  RATE_LIMITED: "少し時間をおいて、もう一度お試しください。",
  WORLD_NOT_OPEN: "この年の絵馬は、いまは眺めることができます。",
  POSTING_PAUSED: "現在は新しい絵馬の受付を停止しています。",
  VERSION_CONFLICT:
    "別の画面で更新されました。現在保存されている内容を確認してください。",
  ACCOUNT_LINK_CONFLICT:
    "このメールは別の所有者に連携されています。自動では統合しません。",
  INVALID_OTP:
    "認証コードの期限または入力内容を確認してください。再送できます。",
  IDEMPOTENCY_KEY_REUSED:
    "送信内容が変わったため、入力内容を確認してもう一度お試しください。",
  TEMPORARILY_UNAVAILABLE:
    "現在はこの操作を利用できません。入力内容を残したまま、もう一度お試しください。",
};

export function messageForApiError(error: ApiError["error"]): string {
  return ERROR_MESSAGES[error.code] ?? error.message;
}

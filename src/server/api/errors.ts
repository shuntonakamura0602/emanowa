import { randomUUID } from "node:crypto";

import { ZodError } from "zod";

import {
  API_ERROR_HTTP_STATUS,
  type ApiError,
  type ApiErrorCode,
} from "@/domain";
import { DatabaseOperationError, mapDatabaseError } from "@/server/db/errors";

export class ApiRouteError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { status?: number; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiRouteError";
    this.code = code;
    this.status = options.status ?? API_ERROR_HTTP_STATUS[code];
    this.fieldErrors = options.fieldErrors;
  }
}

function zodFieldErrors(error: ZodError): Record<string, string> | undefined {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "request";
    fieldErrors[key] ??= issue.message;
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

export function normalizeApiError(error: unknown): {
  status: number;
  body: ApiError;
} {
  const requestId = randomUUID();

  if (error instanceof ApiRouteError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        },
      },
    };
  }

  if (error instanceof ZodError) {
    const fieldErrors = zodFieldErrors(error);
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "入力内容を確認してください。",
          requestId,
          ...(fieldErrors ? { fieldErrors } : {}),
        },
      },
    };
  }

  const databaseError =
    error instanceof DatabaseOperationError ? error : mapDatabaseError(error);
  return {
    status: databaseError.httpStatus,
    body: {
      error: {
        code: databaseError.code,
        message: databaseError.message,
        requestId,
      },
    },
  };
}

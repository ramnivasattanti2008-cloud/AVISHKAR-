/** Stable, documented error codes (spec section 68). The HTTP layer renders them as { error: { code, message, ... } }. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  INVALID_COORDINATES: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  CSRF_REJECTED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_BAD_RESPONSE: 502,
  DATA_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = ERROR_CODES[code];
  }
}

/** A provider failed or returned something we refuse to use. Carries which provider, so the UI can say so (section 42). */
export class ProviderError extends AppError {
  constructor(
    readonly provider: string,
    readonly operation: string,
    message: string,
    code: "PROVIDER_UNAVAILABLE" | "PROVIDER_BAD_RESPONSE" = "PROVIDER_UNAVAILABLE",
    override readonly cause?: unknown,
  ) {
    super(code, message, { provider, operation });
    this.name = "ProviderError";
  }
}

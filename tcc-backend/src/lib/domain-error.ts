export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export type DomainErrorKind = "bad_request" | "forbidden" | "not_found" | "conflict";

export const DOMAIN_ERROR_STATUS: Record<DomainErrorKind, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export class DomainError extends Error {
  constructor(message: string, public readonly code: string, public readonly kind: DomainErrorKind) {
    super(message);
  }
}

/** Mapeia DomainError -> ApiError; `messages` (por code) substitui a mensagem. Outros erros: undefined. */
export function toApiError(error: unknown, messages: Record<string, string> = {}): ApiError | undefined {
  if (!(error instanceof DomainError)) return undefined;
  return new ApiError(DOMAIN_ERROR_STATUS[error.kind], messages[error.code] ?? error.message);
}

export function throwApiError(error: unknown, messages?: Record<string, string>): never {
  throw toApiError(error, messages) ?? error;
}

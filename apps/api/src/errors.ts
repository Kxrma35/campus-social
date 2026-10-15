export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

const CLIENT_ERRORS: Record<number, { error: string; message: string }> = {
  413: { error: "payload_too_large", message: "That request is too large." },
  415: { error: "unsupported_media_type", message: "That kind of content is not accepted here." },
};

export function clientErrorResponse(
  err: unknown,
): { status: number; body: { error: string; message: string } } | null {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  const known = CLIENT_ERRORS[status];
  return {
    status,
    body: known ?? { error: "bad_request", message: "The request could not be read." },
  };
}

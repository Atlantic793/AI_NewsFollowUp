export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 500 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function bad(status: HttpError["status"], code: string, message: string): HttpError {
  return new HttpError(status, code, message);
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export function badRequest(message: string, code = "BAD_REQUEST"): HttpError {
  return new HttpError(400, message, code);
}

export function unauthorized(message = "Sign in required"): HttpError {
  return new HttpError(401, message, "UNAUTHORIZED");
}

export function forbidden(message = "You cannot perform this action"): HttpError {
  return new HttpError(403, message, "FORBIDDEN");
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, message, "NOT_FOUND");
}

export function conflict(message: string, code = "CONFLICT"): HttpError {
  return new HttpError(409, message, code);
}

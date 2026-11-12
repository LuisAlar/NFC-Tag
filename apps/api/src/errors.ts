/** Errors that map straight to an HTTP response with an ErrorResponse body. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = 'Missing or invalid owner token') => new ApiError(401, 'UNAUTHORIZED', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

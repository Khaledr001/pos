import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain error with a stable machine-readable code. The frontend branches on
 * `code`, never on `message`.
 */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what: string) {
    return new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new ApiError(HttpStatus.CONFLICT, code, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }
}

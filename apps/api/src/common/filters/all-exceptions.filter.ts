import type { ApiError } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { RequestContext } from "../context/request-context.js";

/**
 * The single exit point for every failure.
 *
 * Guarantees a client only ever sees the ApiError shape from
 * @devsfleet/shared-types — no stack traces, no Postgres constraint names, no
 * "Cannot read property of undefined" reaching a cashier's screen.
 *
 * Every response carries the request id, which is also on the corresponding log
 * line. "Error XYZ at 14:32" becomes a one-command lookup instead of a hunt.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = RequestContext.requestId;

    const { status, code, message, details } = this.normalise(exception);

    if (status >= 500) {
      this.logger.error(
        { requestId, err: exception },
        `${code}: ${message}`,
      );
    } else {
      this.logger.warn({ requestId, code }, message);
    }

    const body: ApiError = {
      success: false,
      error: { code, message, ...(details ? { details } : {}) },
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, string[]>;
  } {
    // Business failures carrying a stable code.
    if (exception instanceof AppError) {
      return {
        status: this.statusForCode(exception.code),
        code: exception.code,
        message: exception.message,
      };
    }

    // Validation, from ZodValidationPipe.
    if (exception instanceof ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const path = issue.path.join(".") || "_";
        (details[path] ??= []).push(issue.message);
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Request validation failed",
        details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === "string"
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: this.codeForStatus(status),
        message:
          status === HttpStatus.TOO_MANY_REQUESTS
            ? "Too many attempts. Wait a moment and try again."
            : Array.isArray(message)
              ? message.join("; ")
              : message,
      };
    }

    // Postgres errors, surfaced through postgres.js.
    //
    // Drizzle wraps driver failures in a DrizzleQueryError and puts the real
    // PostgresError on `.cause`, so the SQLSTATE is one or more levels down.
    // Without unwrapping, every unique-violation surfaces as a generic 500.
    const pgError = findPostgresError(exception);
    if (pgError) {
      return this.normalisePostgres(pgError.code, pgError.error);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      // Never echo an unknown error's message: it may contain a connection
      // string, a row of customer data, or a file path.
      message: "An unexpected error occurred",
    };
  }

  private normalisePostgres(
    pgCode: string,
    exception: PostgresLikeError,
  ): { status: number; code: string; message: string } {
    // postgres.js exposes the server's field as `constraint_name`; other
    // drivers use `constraint`. Accept either so swapping the driver later
    // does not silently degrade every 409 into a 500.
    const constraint = exception.constraint_name ?? exception.constraint ?? "";

    switch (pgCode) {
      case "23505": // unique_violation
        return {
          status: HttpStatus.CONFLICT,
          code: this.codeForConstraint(constraint),
          message: this.messageForConstraint(constraint),
        };
      case "23503": // foreign_key_violation
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Referenced record does not exist, or is still in use",
        };
      case "23514": // check_violation
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "A database constraint rejected this value",
        };
      case "23P01": // restrict_violation — our ledger immutability triggers
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message:
            "This record is immutable. Write a compensating entry (return, void, " +
            "or adjustment) instead of editing it.",
        };
      case "40001": // serialization_failure
      case "40P01": // deadlock_detected
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: "Concurrent update conflict — retry the request",
        };
      case "57014": // query_canceled (statement_timeout)
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "The query took too long and was cancelled",
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "A database error occurred",
        };
    }
  }

  /** Turn a constraint name into the error code a client can act on. */
  private codeForConstraint(constraint: string): string {
    if (constraint.includes("sku")) return ERROR_CODES.SKU_ALREADY_EXISTS;
    if (constraint.includes("barcode")) return ERROR_CODES.BARCODE_ALREADY_EXISTS;
    if (constraint.includes("checksum")) return ERROR_CODES.DUPLICATE_IMAGE;
    return ERROR_CODES.CONFLICT;
  }

  private messageForConstraint(constraint: string): string {
    if (constraint.includes("sku")) return "A product with this SKU already exists";
    if (constraint.includes("barcode"))
      return "This barcode is already assigned to another product";
    if (constraint.includes("checksum"))
      return "This exact image has already been uploaded";
    if (constraint.includes("serial"))
      return "This serial number is already registered";
    if (constraint.includes("paint_formulas"))
      return "A formula with this colour code and can size already exists";
    return "A record with these values already exists";
  }

  private statusForCode(code: string): number {
    switch (code) {
      case ERROR_CODES.INVALID_CREDENTIALS:
      case ERROR_CODES.TOKEN_EXPIRED:
        return HttpStatus.UNAUTHORIZED;
      case ERROR_CODES.INSUFFICIENT_PERMISSIONS:
      case ERROR_CODES.TENANT_INACTIVE:
      case ERROR_CODES.TENANT_SUSPENDED:
      case ERROR_CODES.ACCOUNT_DISABLED:
      case ERROR_CODES.DEVICE_NOT_REGISTERED:
        return HttpStatus.FORBIDDEN;
      case ERROR_CODES.ACCOUNT_LOCKED:
      case ERROR_CODES.TOO_MANY_REQUESTS:
        // 429: the credentials may well be right; the caller is rate-limited.
        return HttpStatus.TOO_MANY_REQUESTS;
      case ERROR_CODES.DUPLICATE_SLUG:
      case ERROR_CODES.DUPLICATE_EMAIL:
        return HttpStatus.CONFLICT;
      case ERROR_CODES.PRODUCT_NOT_FOUND:
      case ERROR_CODES.CUSTOMER_NOT_FOUND:
      case ERROR_CODES.NOT_FOUND:
        return HttpStatus.NOT_FOUND;
      case ERROR_CODES.SKU_ALREADY_EXISTS:
      case ERROR_CODES.BARCODE_ALREADY_EXISTS:
      case ERROR_CODES.DUPLICATE_IMAGE:
      case ERROR_CODES.CONFLICT:
      case ERROR_CODES.CASH_SESSION_ALREADY_OPEN:
      case ERROR_CODES.DAY_ALREADY_OPEN:
      case ERROR_CODES.DAY_ALREADY_CLOSED:
        return HttpStatus.CONFLICT;
      case ERROR_CODES.VALIDATION_FAILED:
        return HttpStatus.BAD_REQUEST;
      default:
        // Business rules — insufficient stock, credit limit, floor price.
        // 422: the request was well-formed but the business said no.
        return HttpStatus.UNPROCESSABLE_ENTITY;
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.INVALID_CREDENTIALS;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.INSUFFICIENT_PERMISSIONS;
      /**
       * Rate limiting reached the client as INTERNAL_ERROR, so the POS could
       * not tell "you are going too fast" from "the server is broken" — and a
       * sync engine that reads a 429 as a server fault retries harder, which
       * is the opposite of what the limit is asking for.
       */
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.TOO_MANY_REQUESTS;
      default:
        return ERROR_CODES.INTERNAL_ERROR;
    }
  }
}

/** Shape of the driver errors this filter knows how to translate. */
interface PostgresLikeError {
  code: string;
  constraint_name?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Walk the `cause` chain looking for a PostgreSQL SQLSTATE.
 *
 * Drizzle wraps driver failures in a DrizzleQueryError whose `.cause` is the
 * postgres.js PostgresError, and a nested transaction can add another layer.
 * The depth cap is a cycle guard — an error graph that points at itself would
 * otherwise hang the request that is already failing.
 */
function findPostgresError(
  error: unknown,
  depth = 0,
): { code: string; error: PostgresLikeError } | null {
  if (depth > 5 || error === null || typeof error !== "object") return null;

  const candidate = error as PostgresLikeError & { cause?: unknown };
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return { code: candidate.code, error: candidate };
  }

  return candidate.cause ? findPostgresError(candidate.cause, depth + 1) : null;
}

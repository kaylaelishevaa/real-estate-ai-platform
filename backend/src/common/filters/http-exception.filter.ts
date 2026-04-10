import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FastifyReply } from 'fastify';

/**
 * Maps Prisma error codes to user-friendly HTTP responses.
 * See https://www.prisma.io/docs/reference/api-reference/error-reference
 */
const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'A record with that value already exists' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Related record not found (invalid reference)' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<any>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // class-validator returns errors as an object with a 'message' array
      if (
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const errorBody = exceptionResponse as { message: string | string[] };
        message = Array.isArray(errorBody.message)
          ? errorBody.message.join(', ')
          : errorBody.message;
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError
    ) {
      // Map known Prisma errors to clean HTTP responses (never leak schema)
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      }
      this.logger.warn(
        `Prisma error ${exception.code} on ${request?.method} ${request?.url}: ${exception.message}`,
      );
    } else {
      // Non-HTTP exceptions: log the real error, send generic message
      this.logger.error(
        `Unhandled exception on ${request?.method} ${request?.url}: ${exception}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // In production, never leak internal error details
      if (process.env.NODE_ENV === 'production') {
        message = 'Internal server error';
      }
    }

    response.status(status).send({
      success: false,
      message: message,
      statusCode: status,
    });
  }
}

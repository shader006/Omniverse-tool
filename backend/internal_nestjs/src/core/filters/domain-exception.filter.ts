import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';

/**
 * Filter chuyển đổi các Domain Exception thành HTTP response chuẩn
 */
@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.BAD_REQUEST;
    if (exception.name.includes('NotFound')) {
      status = HttpStatus.NOT_FOUND;
    } else if (exception.name.includes('Conflict')) {
      status = HttpStatus.CONFLICT;
    } else if (exception.name.includes('Unauthorized')) {
      status = HttpStatus.UNAUTHORIZED;
    }

    response.status(status).json({
      statusCode: status,
      error: exception.name,
      message: exception.message,
      timestamp: new Date().toISOString(),
    });
  }
}

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';

/**
 * Filter chuyển đổi các Domain Exception và HttpException thành HTTP response chuẩn
 * Tương thích đồng thời với hợp đồng JSON của Go Gateway (success, detail, error) và NestJS.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Lỗi hệ thống nội bộ';
    let errorName = 'InternalServerError';

    if (exception instanceof DomainException) {
      errorName = exception.name;
      message = exception.message;
      status = HttpStatus.BAD_REQUEST;
      if (exception.name.includes('NotFound')) {
        status = HttpStatus.NOT_FOUND;
      } else if (exception.name.includes('Conflict')) {
        status = HttpStatus.CONFLICT;
      } else if (exception.name.includes('Unauthorized')) {
        status = HttpStatus.UNAUTHORIZED;
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorName = exception.name;
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const resObj = res as Record<string, any>;
        if (Array.isArray(resObj.message)) {
          message = resObj.message.join(', ');
        } else {
          message = resObj.detail || resObj.message || resObj.error || exception.message;
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      errorName = exception.name;
      message = exception.message;
    }

    response.status(status).json({
      success: false,
      detail: message,
      error: message,
      errorName,
      message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}

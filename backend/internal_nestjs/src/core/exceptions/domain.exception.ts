/**
 * Core Domain Exception - Lớp cơ sở cho toàn bộ ngoại lệ nghiệp vụ
 * Không phụ thuộc vào HTTP status hay bất kỳ framework nào
 */
export abstract class DomainException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

import { DomainException } from '../../../../core/exceptions/domain.exception';

export class TaskNotFoundException extends DomainException {
  constructor(taskId: string) {
    super(`Không tìm thấy Task với ID: ${taskId}`);
  }
}

export class TaskCannotCancelException extends DomainException {
  constructor(status: string) {
    super(`Không thể huỷ tác vụ đang ở trạng thái: ${status}`);
  }
}

export class TaskFileNotFoundException extends DomainException {
  constructor(filename: string) {
    super(`Không tìm thấy file: ${filename}`);
  }
}

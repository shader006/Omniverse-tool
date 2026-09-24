import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { ValueObject } from '../../../../core/base/value-object.base';
import { DomainException } from '../../../../core/exceptions/domain.exception';

export class InvalidTaskIdException extends DomainException {
  constructor(id: string) {
    super(`Task ID "${id}" không hợp lệ.`);
  }
}

export interface TaskIdProps {
  value: string;
}

export class TaskId extends ValueObject<TaskIdProps> {
  constructor(id?: string) {
    const value = id || uuidv4();
    if (!value || value.trim() === '') {
      throw new InvalidTaskIdException(value);
    }
    super({ value: value.trim() });
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}

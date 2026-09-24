import { Inject, Injectable } from '@nestjs/common';
import { TaskEntity } from '../../domain/entities/task.entity';
import { TaskId } from '../../domain/value-objects/task-id.vo';
import { TaskRepositoryPort } from '../../domain/ports/task.repository.port';
import { TASK_REPOSITORY_PORT } from '../ports/task-repository.token';
import { TaskNotFoundException } from '../../domain/exceptions/task.exceptions';

@Injectable()
export class CancelTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY_PORT)
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  async execute(id: string): Promise<TaskEntity> {
    const taskId = new TaskId(id);
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundException(id);
    }

    task.cancel();
    await this.taskRepo.save(task);
    this.taskRepo.publish(task);
    return task;
  }
}

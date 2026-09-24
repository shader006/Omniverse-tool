import { Inject, Injectable } from '@nestjs/common';
import { TaskEntity } from '../../domain/entities/task.entity';
import { TaskId } from '../../domain/value-objects/task-id.vo';
import { TaskStatus } from '../../domain/value-objects/task-status.enum';
import { TaskRepositoryPort } from '../../domain/ports/task.repository.port';
import { TASK_REPOSITORY_PORT } from '../ports/task-repository.token';
import { TaskNotFoundException } from '../../domain/exceptions/task.exceptions';

export interface UpdateTaskProgressCommand {
  id: string;
  percent?: number;
  speed?: string;
  eta?: string;
  status?: TaskStatus;
  filename?: string;
  downloadUrl?: string;
  error?: string;
}

@Injectable()
export class UpdateTaskProgressUseCase {
  constructor(
    @Inject(TASK_REPOSITORY_PORT)
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  async execute(command: UpdateTaskProgressCommand): Promise<TaskEntity> {
    const taskId = new TaskId(command.id);
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundException(command.id);
    }

    if (command.percent !== undefined) {
      task.updateProgress(command.percent, command.speed, command.eta);
    }
    if (command.status) {
      task.updateStatus(command.status);
    }
    if (command.filename) {
      task.markCompleted(command.filename, command.downloadUrl);
    }
    if (command.error) {
      task.markError(command.error);
    }

    await this.taskRepo.save(task);
    this.taskRepo.publish(task);
    return task;
  }
}

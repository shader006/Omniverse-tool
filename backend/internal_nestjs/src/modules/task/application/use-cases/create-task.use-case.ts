import { Inject, Injectable } from '@nestjs/common';
import { TaskEntity, CreateTaskProps } from '../../domain/entities/task.entity';
import { TaskRepositoryPort } from '../../domain/ports/task.repository.port';
import { TASK_REPOSITORY_PORT } from '../ports/task-repository.token';

@Injectable()
export class CreateTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY_PORT)
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  async execute(props: CreateTaskProps): Promise<TaskEntity> {
    const task = new TaskEntity(props);
    await this.taskRepo.save(task);
    this.taskRepo.publish(task);
    return task;
  }
}

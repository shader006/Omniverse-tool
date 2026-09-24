import { Inject, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TaskEntity } from '../../domain/entities/task.entity';
import { TaskId } from '../../domain/value-objects/task-id.vo';
import { TaskRepositoryPort } from '../../domain/ports/task.repository.port';
import { TASK_REPOSITORY_PORT } from '../ports/task-repository.token';

@Injectable()
export class SubscribeTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY_PORT)
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  execute(id: string): Observable<TaskEntity> {
    const taskId = new TaskId(id);
    return this.taskRepo.subscribe(taskId);
  }
}

import { Observable } from 'rxjs';
import { RepositoryPort } from '../../../../core/ports/repository.port';
import { TaskEntity } from '../entities/task.entity';
import { TaskId } from '../value-objects/task-id.vo';

export interface TaskRepositoryPort extends RepositoryPort<TaskEntity, TaskId> {
  subscribe(id: TaskId): Observable<TaskEntity>;
  publish(task: TaskEntity): void;
}

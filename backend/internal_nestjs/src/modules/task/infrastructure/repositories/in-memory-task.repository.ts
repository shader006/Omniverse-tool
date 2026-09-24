import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { TaskRepositoryPort } from '../../domain/ports/task.repository.port';
import { TaskEntity } from '../../domain/entities/task.entity';
import { TaskId } from '../../domain/value-objects/task-id.vo';

@Injectable()
export class InMemoryTaskRepository implements TaskRepositoryPort {
  private readonly store: Map<string, TaskEntity> = new Map();
  private readonly streamSubject: Subject<TaskEntity> = new Subject();

  async save(task: TaskEntity): Promise<void> {
    this.store.set(task.id.value, task);
  }

  async findById(id: TaskId): Promise<TaskEntity | null> {
    return this.store.get(id.value) || null;
  }

  async findAll(): Promise<TaskEntity[]> {
    return Array.from(this.store.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async delete(id: TaskId): Promise<boolean> {
    return this.store.delete(id.value);
  }

  publish(task: TaskEntity): void {
    this.streamSubject.next(task);
  }

  subscribe(id: TaskId): Observable<TaskEntity> {
    return this.streamSubject
      .asObservable()
      .pipe(filter((task) => task.id.value === id.value));
  }
}

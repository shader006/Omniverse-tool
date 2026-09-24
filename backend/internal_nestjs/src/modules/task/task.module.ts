import { Module } from '@nestjs/common';
import { TaskHttpController } from './interface-adapters/controllers/task.http.controller';
import { GetTaskUseCase } from './application/use-cases/get-task.use-case';
import { CancelTaskUseCase } from './application/use-cases/cancel-task.use-case';
import { CreateTaskUseCase } from './application/use-cases/create-task.use-case';
import { UpdateTaskProgressUseCase } from './application/use-cases/update-task-progress.use-case';
import { SubscribeTaskUseCase } from './application/use-cases/subscribe-task.use-case';
import { InMemoryTaskRepository } from './infrastructure/repositories/in-memory-task.repository';
import { TASK_REPOSITORY_PORT } from './application/ports/task-repository.token';

@Module({
  controllers: [TaskHttpController],
  providers: [
    GetTaskUseCase,
    CancelTaskUseCase,
    CreateTaskUseCase,
    UpdateTaskProgressUseCase,
    SubscribeTaskUseCase,
    {
      provide: TASK_REPOSITORY_PORT,
      useClass: InMemoryTaskRepository,
    },
  ],
  exports: [
    GetTaskUseCase,
    CreateTaskUseCase,
    UpdateTaskProgressUseCase,
    CancelTaskUseCase,
    TASK_REPOSITORY_PORT,
  ],
})
export class TaskModule {}

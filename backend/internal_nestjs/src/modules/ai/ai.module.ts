import { Module } from '@nestjs/common';
import { AiHttpController } from './interface-adapters/controllers/ai.http.controller';
import { HttpAiWorkerAdapter } from './infrastructure/adapters/http-ai-worker.adapter';
import { AI_WORKER_PORT } from './application/ports/ai-worker.token';

@Module({
  controllers: [AiHttpController],
  providers: [
    {
      provide: AI_WORKER_PORT,
      useClass: HttpAiWorkerAdapter,
    },
  ],
  exports: [AI_WORKER_PORT],
})
export class AiModule {}

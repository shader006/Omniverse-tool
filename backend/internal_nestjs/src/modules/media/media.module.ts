import { Module } from '@nestjs/common';
import { MediaHttpController } from './interface-adapters/controllers/media.http.controller';
import { GetMediaInfoUseCase } from './application/use-cases/get-media-info.use-case';
import { StartDownloadUseCase } from './application/use-cases/start-download.use-case';
import { HttpMediaWorkerAdapter } from './infrastructure/adapters/http-media-worker.adapter';
import { MEDIA_WORKER_PORT } from './application/ports/media-worker.token';
import { TaskModule } from '../task/task.module';

@Module({
  imports: [TaskModule],
  controllers: [MediaHttpController],
  providers: [
    GetMediaInfoUseCase,
    StartDownloadUseCase,
    {
      provide: MEDIA_WORKER_PORT,
      useClass: HttpMediaWorkerAdapter,
    },
  ],
  exports: [GetMediaInfoUseCase, StartDownloadUseCase],
})
export class MediaModule {}

import { Module } from '@nestjs/common';
import { ConvertHttpController } from './interface-adapters/controllers/convert.http.controller';
import { HttpConvertWorkerAdapter } from './infrastructure/adapters/http-convert-worker.adapter';
import { CONVERT_WORKER_PORT } from './application/ports/convert-worker.token';

@Module({
  controllers: [ConvertHttpController],
  providers: [
    {
      provide: CONVERT_WORKER_PORT,
      useClass: HttpConvertWorkerAdapter,
    },
  ],
  exports: [CONVERT_WORKER_PORT],
})
export class ConvertModule {}

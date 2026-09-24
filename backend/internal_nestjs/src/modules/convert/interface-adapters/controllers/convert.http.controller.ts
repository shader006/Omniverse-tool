import { Controller, Post, Body, Inject } from '@nestjs/common';
import { ConvertWorkerPort } from '../../domain/ports/convert-worker.port';
import { CONVERT_WORKER_PORT } from '../../application/ports/convert-worker.token';

@Controller('convert')
export class ConvertHttpController {
  constructor(
    @Inject(CONVERT_WORKER_PORT)
    private readonly convertWorker: ConvertWorkerPort,
  ) {}

  @Post('file')
  convertFile(@Body() body: any) {
    return this.convertWorker.convertDocument(body);
  }
}

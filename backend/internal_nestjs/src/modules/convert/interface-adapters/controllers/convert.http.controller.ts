import { Controller, Post, Req, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { ConvertWorkerPort } from '../../domain/ports/convert-worker.port';
import { CONVERT_WORKER_PORT } from '../../application/ports/convert-worker.token';

@Controller('convert')
export class ConvertHttpController {
  constructor(
    @Inject(CONVERT_WORKER_PORT)
    private readonly convertWorker: ConvertWorkerPort,
  ) {}

  @Post('file')
  @HttpCode(HttpStatus.OK)
  async convertFile(@Req() req: Request) {
    return this.convertWorker.convertMultipartRequest(req);
  }
}

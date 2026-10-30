import {
  Controller,
  Get,
  Post,
  All,
  Req,
  Res,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AiWorkerPort } from '../../domain/ports/ai-worker.port';
import { AI_WORKER_PORT } from '../../application/ports/ai-worker.token';

@Controller()
export class AiHttpController {
  constructor(
    @Inject(AI_WORKER_PORT)
    private readonly aiWorker: AiWorkerPort,
  ) {}

  /**
   * Health checks
   */
  @Get('pixel/health')
  getPixelHealth() {
    return this.aiWorker.checkHealth('pixelfixer');
  }

  @Get('upscale/health')
  getUpscaleHealth() {
    return this.aiWorker.checkHealth('upscaler');
  }

  /**
   * PixelFixer APIs (chỉ cho phép POST, các method khác trả về 405)
   */
  @All('pixel/detect')
  detectPixels(@Req() req: Request, @Res() res: Response) {
    return this.aiWorker.forwardRawStream('pixelfixer', '/api/pixel/detect', req, res);
  }

  @All('pixel/fix')
  fixPixels(@Req() req: Request, @Res() res: Response) {
    return this.aiWorker.forwardRawStream('pixelfixer', '/api/pixel/fix', req, res);
  }

  /**
   * Upscaler API (chỉ cho phép POST, các method khác trả về 405)
   */
  @All('upscale')
  upscaleImage(@Req() req: Request, @Res() res: Response) {
    return this.aiWorker.forwardRawStream('upscaler', '/api/upscale', req, res);
  }

  /**
   * Whisper Transcribe & RMBG Remove Background
   */
  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  transcribeAudio(@Req() req: Request, @Res() res: Response) {
    return this.aiWorker.handleTranscribe(req, res);
  }

  @Post('remove-bg')
  @HttpCode(HttpStatus.OK)
  removeBackground(@Req() req: Request, @Res() res: Response) {
    return this.aiWorker.handleRemoveBackground(req, res);
  }
}

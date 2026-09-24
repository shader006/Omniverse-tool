import { Controller, Get, Post, Body, Inject } from '@nestjs/common';
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
   * PixelFixer APIs
   */
  @Post('pixel/detect')
  detectPixels(@Body() body: any) {
    return this.aiWorker.proxyPost('pixelfixer', '/detect', body);
  }

  @Post('pixel/fix')
  fixPixels(@Body() body: any) {
    return this.aiWorker.proxyPost('pixelfixer', '/fix', body);
  }

  /**
   * Upscaler API
   */
  @Post('upscale')
  upscaleImage(@Body() body: any) {
    return this.aiWorker.proxyPost('upscaler', '/upscale', body);
  }

  /**
   * Whisper Transcribe & RMBG Remove Background
   */
  @Post('transcribe')
  transcribeAudio(@Body() body: any) {
    return this.aiWorker.proxyPost('whisper', '/transcribe', body);
  }

  @Post('remove-bg')
  removeBackground(@Body() body: any) {
    return this.aiWorker.proxyPost('rmbg', '/remove-bg', body);
  }
}

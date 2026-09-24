import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /**
   * Health check endpoint: /health hoặc /api/health
   */
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      engine: 'NestJS Hexagonal DDD',
      timestamp: new Date().toISOString(),
    };
  }
}

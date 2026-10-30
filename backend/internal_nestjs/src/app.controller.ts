import { Controller, Get } from '@nestjs/common';

export async function buildGatewayHealthResponse() {
  const gotenbergUrl = process.env.GOTENBERG_URL || 'http://tasks.gotenberg:3000';
  let gotenbergHealthy = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${gotenbergUrl.replace(/\/$/, '')}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    gotenbergHealthy = resp.ok;
  } catch {
    gotenbergHealthy = false;
  }

  return {
    status: 'healthy',
    engine: 'NestJS Hexagonal DDD',
    version: '3.1.0',
    gotenberg_status: gotenbergHealthy,
    gotenberg_url: gotenbergUrl,
    lb_algorithm: 'Swarm-DNSRR-Hexagonal',
    timestamp: new Date().toISOString(),
  };
}

@Controller()
export class AppController {
  /**
   * Health check endpoint: /api/health (và /health được gắn trên Express)
   */
  @Get('health')
  async getHealth() {
    return buildGatewayHealthResponse();
  }
}

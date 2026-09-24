import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AiWorkerPort } from '../../domain/ports/ai-worker.port';

@Injectable()
export class HttpAiWorkerAdapter implements AiWorkerPort {
  private getServiceUrl(service: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): string {
    switch (service) {
      case 'pixelfixer':
        return process.env.WORKER_PIXELFIXER_URL || 'http://worker-pixelfixer:8004';
      case 'upscaler':
        return process.env.WORKER_UPSCALER_URL || 'http://worker-upscaler:8006';
      case 'whisper':
        return process.env.WORKER_WHISPER_URL || 'http://worker-whisper:8002';
      case 'rmbg':
        return process.env.WORKER_RMBG_URL || 'http://worker-rmbg:8003';
    }
  }

  async checkHealth(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): Promise<{ status: string; service: string }> {
    const url = this.getServiceUrl(serviceName);
    try {
      const resp = await fetch(`${url}/health`, { method: 'GET' });
      if (resp.ok) {
        return { status: 'healthy', service: serviceName };
      }
      return { status: 'degraded', service: serviceName };
    } catch {
      return { status: 'unreachable', service: serviceName };
    }
  }

  async proxyPost(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg', path: string, body: any): Promise<any> {
    const baseUrl = this.getServiceUrl(serviceName);
    const targetUrl = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    try {
      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `AI worker ${serviceName} error HTTP ${resp.status}`);
      }

      return await resp.json();
    } catch (err: any) {
      throw new InternalServerErrorException(`Lỗi giao tiếp với AI worker (${serviceName}): ${err.message}`);
    }
  }
}

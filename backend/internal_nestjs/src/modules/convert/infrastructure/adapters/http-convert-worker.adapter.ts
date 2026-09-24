import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConvertWorkerPort } from '../../domain/ports/convert-worker.port';

@Injectable()
export class HttpConvertWorkerAdapter implements ConvertWorkerPort {
  private getGotenbergUrl(): string {
    return process.env.GOTENBERG_URL || 'http://gotenberg:3000';
  }

  async convertDocument(payload: any): Promise<any> {
    const gotenbergUrl = this.getGotenbergUrl();
    try {
      const resp = await fetch(`${gotenbergUrl}/health`, { method: 'GET' });
      return {
        status: resp.ok ? 'connected' : 'degraded',
        gotenberg_url: gotenbergUrl,
      };
    } catch (err: any) {
      throw new InternalServerErrorException(`Không thể kết nối dịch vụ Gotenberg: ${err.message}`);
    }
  }
}

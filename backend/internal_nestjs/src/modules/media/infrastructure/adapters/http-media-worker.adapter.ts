import { Injectable, BadRequestException } from '@nestjs/common';
import {
  MediaWorkerPort,
  MediaInfoResult,
  DownloadProgressEvent,
} from '../../domain/ports/media-worker.port';

@Injectable()
export class HttpMediaWorkerAdapter implements MediaWorkerPort {
  private getWorkerUrl(): string {
    return process.env.WORKER_YTDLP_URL || 'http://tasks.worker-ytdlp:8001';
  }

  async fetchMediaInfo(url: string): Promise<MediaInfoResult> {
    const workerUrl = this.getWorkerUrl();
    try {
      const resp = await fetch(`${workerUrl}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!resp.ok) {
        let errorMsg = `Worker returned HTTP ${resp.status}`;
        try {
          const errJson = await resp.json();
          errorMsg = errJson.detail || errJson.error || errJson.message || errorMsg;
        } catch {
          const text = await resp.text();
          if (text) errorMsg = text;
        }
        throw new BadRequestException(errorMsg);
      }

      const json = await resp.json();
      if (json && json.success === false) {
        throw new BadRequestException(
          json.error || json.detail || 'Không thể trích xuất thông tin từ liên kết này.',
        );
      }
      return (json.data || json) as MediaInfoResult;
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(
        `Không thể trích xuất thông tin từ liên kết này: ${err.message}`,
      );
    }
  }

  async triggerDownload(
    payload: {
      job_id: string;
      url: string;
      format: string;
      quality: string;
      download_dir: string;
    },
    onProgress: (event: DownloadProgressEvent) => void,
  ): Promise<void> {
    const workerUrl = this.getWorkerUrl();
    const resp = await fetch(`${workerUrl}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(errorText || `Worker download error HTTP ${resp.status}`);
    }

    if (!resp.body) return;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          onProgress(parsed);
        } catch {}
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        onProgress(parsed);
      } catch {}
    }
  }
}

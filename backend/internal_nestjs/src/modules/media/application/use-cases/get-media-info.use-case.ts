import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { MediaWorkerPort, MediaInfoResult } from '../../domain/ports/media-worker.port';
import { MEDIA_WORKER_PORT } from '../ports/media-worker.token';
import * as crypto from 'crypto';

export function cleanUrlKey(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const v = u.searchParams.get('v');
      if (v) {
        return `https://www.youtube.com/watch?v=${v}`;
      }
      if (u.hostname.includes('youtu.be')) {
        const p = u.pathname.replace(/^\//, '');
        if (p) {
          return `https://www.youtube.com/watch?v=${p}`;
        }
      }
    }
  } catch {
    // ignore URL parse error
  }
  return trimmed;
}

export function isInternalOrLoopbackUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '169.254.169.254' ||
      host.startsWith('127.') ||
      host.startsWith('169.254.')
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function generateMediaCacheKey(rawUrl: string, format: string, quality: string): string {
  const cleaned = cleanUrlKey(rawUrl);
  const raw = `${cleaned}_${format.toLowerCase()}_${quality}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 10);
}

@Injectable()
export class GetMediaInfoUseCase {
  private readonly metaCache = new Map<string, { data: MediaInfoResult; expiresAt: number }>();
  private readonly cacheTtlMs = 3600 * 1000;

  constructor(
    @Inject(MEDIA_WORKER_PORT)
    private readonly mediaWorker: MediaWorkerPort,
  ) {}

  async execute(rawUrl: string): Promise<{ data: MediaInfoResult; cached: boolean }> {
    const url = (rawUrl || '').trim();
    if (!url) {
      throw new BadRequestException('Dữ liệu yêu cầu không hợp lệ hoặc thiếu URL.');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new BadRequestException('URL không hợp lệ. Đường dẫn phải bắt đầu bằng http:// hoặc https://');
    }
    if (isInternalOrLoopbackUrl(url)) {
      throw new BadRequestException('URL nội bộ hoặc loopback không được phép truy cập.');
    }

    const cacheKey = generateMediaCacheKey(url, 'info', 'info');
    const cachedItem = this.metaCache.get(cacheKey);
    if (cachedItem && Date.now() < cachedItem.expiresAt) {
      return { data: cachedItem.data, cached: true };
    }

    const data = await this.mediaWorker.fetchMediaInfo(url);
    if (data) {
      this.metaCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }
    return { data, cached: false };
  }
}

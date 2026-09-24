import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { MediaWorkerPort, MediaInfoResult } from '../../domain/ports/media-worker.port';
import { MEDIA_WORKER_PORT } from '../ports/media-worker.token';

@Injectable()
export class GetMediaInfoUseCase {
  constructor(
    @Inject(MEDIA_WORKER_PORT)
    private readonly mediaWorker: MediaWorkerPort,
  ) {}

  async execute(url: string): Promise<MediaInfoResult> {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      throw new BadRequestException('URL không hợp lệ. Phải bắt đầu bằng http:// hoặc https://');
    }
    return this.mediaWorker.fetchMediaInfo(url);
  }
}

import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { MediaWorkerPort } from '../../domain/ports/media-worker.port';
import { MEDIA_WORKER_PORT } from '../ports/media-worker.token';
import { CreateTaskUseCase } from '../../../task/application/use-cases/create-task.use-case';
import { UpdateTaskProgressUseCase } from '../../../task/application/use-cases/update-task-progress.use-case';
import { TaskStatus } from '../../../task/domain/value-objects/task-status.enum';
import { cleanUrlKey, isInternalOrLoopbackUrl } from './get-media-info.use-case';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StartDownloadCommand {
  url: string;
  format?: string;
  quality?: string;
}

const ALLOWED_FORMATS = new Set(['mp3', 'mp4', 'm4a', 'wav', 'flac', 'webm']);
const ALLOWED_QUALITIES = new Set([
  '64', '128', '192', '256', '320',
  '360', '480', '720', '1080', '1440', '2160', 'best',
]);

@Injectable()
export class StartDownloadUseCase {
  constructor(
    @Inject(MEDIA_WORKER_PORT)
    private readonly mediaWorker: MediaWorkerPort,
    private readonly createTaskUseCase: CreateTaskUseCase,
    private readonly updateTaskProgressUseCase: UpdateTaskProgressUseCase,
  ) {}

  private findCachedFile(rawUrl: string, format: string, quality: string, downloadDir: string): string | null {
    try {
      if (!fs.existsSync(downloadDir)) return null;
      const cleaned = cleanUrlKey(rawUrl);
      const rawKey = `${cleaned}_${format.toLowerCase()}_${quality}`;
      const prefixMd5 = crypto.createHash('md5').update(rawKey).digest('hex').slice(0, 10);
      const prefixSha = crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 10);
      const prefixSha12 = crypto
        .createHash('sha256')
        .update(`${rawUrl.trim()}_${format.toLowerCase()}_${quality}`)
        .digest('hex')
        .slice(0, 12);

      const entries = fs.readdirSync(downloadDir, { withFileTypes: true });
      const now = Date.now();
      const targetExt = `.${format.toLowerCase()}`;

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (
          name.startsWith(prefixMd5) ||
          name.startsWith(prefixSha) ||
          name.startsWith(prefixSha12)
        ) {
          const lower = name.toLowerCase();
          if (lower.endsWith('.part') || lower.endsWith('.ytdl')) continue;
          if (!lower.endsWith(targetExt)) continue;
          const stat = fs.statSync(path.join(downloadDir, name));
          if (now - stat.mtimeMs < 3600 * 1000 && stat.size > 0) {
            return name;
          }
        }
      }
    } catch {
      // ignore disk read errors
    }
    return null;
  }

  async execute(command: StartDownloadCommand): Promise<{ job_id: string; status: string; cached: boolean }> {
    const url = (command.url || '').trim();
    if (!url) {
      throw new BadRequestException('Dữ liệu yêu cầu không hợp lệ hoặc thiếu URL.');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new BadRequestException('URL không hợp lệ. Đường dẫn phải bắt đầu bằng http:// hoặc https://');
    }
    if (isInternalOrLoopbackUrl(url)) {
      throw new BadRequestException('URL nội bộ hoặc loopback không được phép truy cập.');
    }

    let format = (command.format || '').trim().toLowerCase();
    if (!format) {
      format = 'mp3';
    }
    if (!ALLOWED_FORMATS.has(format)) {
      throw new BadRequestException(
        `Định dạng '${format}' không được hỗ trợ. Các định dạng hợp lệ: mp3, mp4, m4a, wav, flac, webm.`,
      );
    }

    let quality = String(command.quality ?? '').trim().toLowerCase();
    if (!quality) {
      quality = format === 'mp4' ? '720' : '320';
    }
    if (!ALLOWED_QUALITIES.has(quality)) {
      throw new BadRequestException(
        `Chất lượng '${quality}' không hợp lệ. Các chất lượng hợp lệ: 64, 128, 192, 256, 320, 360, 480, 720, 1080, 1440, 2160, best.`,
      );
    }

    const downloadDir = process.env.DOWNLOAD_DIR || '/app/downloads';
    const cachedFile = this.findCachedFile(url, format, quality, downloadDir);

    if (cachedFile) {
      const task = await this.createTaskUseCase.execute({
        url,
        format,
        quality,
        status: TaskStatus.COMPLETED,
        percent: 100,
        speed: 'Cached',
        eta: '0s',
        filename: cachedFile,
        downloadUrl: `/api/file/${cachedFile}`,
      });
      return {
        job_id: task.id.value,
        status: 'completed',
        cached: true,
      };
    }

    const task = await this.createTaskUseCase.execute({
      url,
      format,
      quality,
      status: TaskStatus.QUEUED,
    });

    const jobId = task.id.value;

    // Gọi stream bất đồng bộ sang worker
    (async () => {
      try {
        await this.mediaWorker.triggerDownload(
          {
            job_id: jobId,
            url,
            format,
            quality,
            download_dir: downloadDir,
          },
          async (event) => {
            if (event.status === 'downloading') {
              await this.updateTaskProgressUseCase.execute({
                id: jobId,
                status: TaskStatus.DOWNLOADING,
                percent: event.percent,
                speed: event.speed,
                eta: event.eta,
              });
            } else if (event.status === 'completed') {
              await this.updateTaskProgressUseCase.execute({
                id: jobId,
                status: TaskStatus.COMPLETED,
                percent: 100,
                filename: event.filename,
                downloadUrl: `/api/file/${event.filename}`,
              });
            } else if (event.status === 'error') {
              await this.updateTaskProgressUseCase.execute({
                id: jobId,
                status: TaskStatus.ERROR,
                error: event.error || 'Không thể tải hoặc chuyển đổi file media từ liên kết.',
              });
            }
          },
        );
      } catch (err: any) {
        await this.updateTaskProgressUseCase.execute({
          id: jobId,
          status: TaskStatus.ERROR,
          error: err?.message || 'Lỗi tải video từ worker',
        });
      }
    })();

    return {
      job_id: jobId,
      status: 'queued',
      cached: false,
    };
  }
}

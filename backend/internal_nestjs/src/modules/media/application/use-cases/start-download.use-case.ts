import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { MediaWorkerPort } from '../../domain/ports/media-worker.port';
import { MEDIA_WORKER_PORT } from '../ports/media-worker.token';
import { CreateTaskUseCase } from '../../../task/application/use-cases/create-task.use-case';
import { UpdateTaskProgressUseCase } from '../../../task/application/use-cases/update-task-progress.use-case';
import { TaskStatus } from '../../../task/domain/value-objects/task-status.enum';

export interface StartDownloadCommand {
  url: string;
  format?: string;
  quality?: string;
}

@Injectable()
export class StartDownloadUseCase {
  constructor(
    @Inject(MEDIA_WORKER_PORT)
    private readonly mediaWorker: MediaWorkerPort,
    private readonly createTaskUseCase: CreateTaskUseCase,
    private readonly updateTaskProgressUseCase: UpdateTaskProgressUseCase,
  ) {}

  async execute(command: StartDownloadCommand): Promise<{ job_id: string; status: string }> {
    if (!command.url || (!command.url.startsWith('http://') && !command.url.startsWith('https://'))) {
      throw new BadRequestException('URL không hợp lệ. Phải bắt đầu bằng http:// hoặc https://');
    }

    const format = command.format || 'mp4';
    const quality = command.quality || '1080p';

    const task = await this.createTaskUseCase.execute({
      url: command.url,
      format,
      quality,
      status: TaskStatus.QUEUED,
    });

    const jobId = task.id.value;
    const downloadDir = process.env.DOWNLOAD_DIR || '/app/downloads';

    // Gọi stream bất đồng bộ sang worker
    (async () => {
      try {
        await this.mediaWorker.triggerDownload(
          {
            job_id: jobId,
            url: command.url,
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
                error: event.error || 'Lỗi khi tải file',
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
    };
  }
}

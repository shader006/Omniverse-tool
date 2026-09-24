import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Res,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import * as path from 'path';
import * as fs from 'fs';
import { GetTaskUseCase } from '../../application/use-cases/get-task.use-case';
import { CancelTaskUseCase } from '../../application/use-cases/cancel-task.use-case';
import { SubscribeTaskUseCase } from '../../application/use-cases/subscribe-task.use-case';
import { TaskResponseDto } from '../dtos/task.response.dto';
import { TaskMapper } from '../mappers/task.mapper';
import { TaskFileNotFoundException } from '../../domain/exceptions/task.exceptions';

@Controller()
export class TaskHttpController {
  constructor(
    private readonly getTaskUseCase: GetTaskUseCase,
    private readonly cancelTaskUseCase: CancelTaskUseCase,
    private readonly subscribeTaskUseCase: SubscribeTaskUseCase,
  ) {}

  /**
   * GET /api/status/:id - Lấy trạng thái Task
   */
  @Get('status/:id')
  async getStatus(@Param('id') id: string): Promise<TaskResponseDto> {
    const task = await this.getTaskUseCase.execute(id);
    return TaskMapper.toResponse(task);
  }

  /**
   * POST & DELETE /api/cancel/:id - Huỷ bỏ Task
   */
  @Post('cancel/:id')
  async cancelTaskPost(@Param('id') id: string): Promise<TaskResponseDto> {
    const task = await this.cancelTaskUseCase.execute(id);
    return TaskMapper.toResponse(task);
  }

  @Delete('cancel/:id')
  async cancelTaskDelete(@Param('id') id: string): Promise<TaskResponseDto> {
    const task = await this.cancelTaskUseCase.execute(id);
    return TaskMapper.toResponse(task);
  }

  /**
   * GET /api/stream/:id - Server-Sent Events (SSE) theo dõi tiến độ thời gian thực
   * Phát event 'progress' khớp với frontend EventSource
   */
  @Sse('stream/:id')
  async streamTask(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const initialTask = await this.getTaskUseCase.execute(id).catch(() => null);
    const stream$ = this.subscribeTaskUseCase.execute(id);

    const mapped$ = stream$.pipe(
      map((task) => ({
        type: 'progress',
        data: JSON.stringify(TaskMapper.toResponse(task)),
      } as MessageEvent)),
    );

    if (initialTask) {
      return mapped$.pipe(
        startWith({
          type: 'progress',
          data: JSON.stringify(TaskMapper.toResponse(initialTask)),
        } as MessageEvent),
      );
    }
    return mapped$;
  }

  /**
   * GET /api/file/:filename - Phục vụ file kết quả tải về từ DOWNLOAD_DIR
   */
  @Get('file/:filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response): void {
    const safeFilename = path.basename(filename);
    const downloadDir = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');
    const filePath = path.join(downloadDir, safeFilename);

    if (!fs.existsSync(filePath)) {
      throw new TaskFileNotFoundException(safeFilename);
    }

    res.download(filePath, safeFilename);
  }
}

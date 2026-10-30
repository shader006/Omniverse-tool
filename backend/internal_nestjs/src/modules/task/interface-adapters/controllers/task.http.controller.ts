import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
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
  async cancelTaskPost(@Param('id') id: string) {
    const task = await this.cancelTaskUseCase.execute(id);
    return {
      success: true,
      message: 'Đã huỷ tác vụ thành công',
      job: TaskMapper.toResponse(task),
    };
  }

  @Delete('cancel/:id')
  async cancelTaskDelete(@Param('id') id: string) {
    const task = await this.cancelTaskUseCase.execute(id);
    return {
      success: true,
      message: 'Đã huỷ tác vụ thành công',
      job: TaskMapper.toResponse(task),
    };
  }

  /**
   * GET /api/stream/:id - Server-Sent Events (SSE) theo dõi tiến độ thời gian thực
   * Phát event 'progress' khớp với frontend EventSource và tự đóng khi completed/error
   */
  @Get('stream/:id')
  async streamTask(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (dto: TaskResponseDto) => {
      res.write(`event: progress\ndata: ${JSON.stringify(dto)}\n\n`);
    };

    const initialTask = await this.getTaskUseCase.execute(id).catch(() => null);
    if (initialTask) {
      const dto = TaskMapper.toResponse(initialTask);
      writeEvent(dto);
      if (dto.status === 'completed' || dto.status === 'error') {
        res.end();
        return;
      }
    }

    let closed = false;
    const stream$ = this.subscribeTaskUseCase.execute(id);
    const sub = stream$.subscribe((task) => {
      if (closed) return;
      const dto = TaskMapper.toResponse(task);
      writeEvent(dto);
      if (dto.status === 'completed' || dto.status === 'error') {
        closed = true;
        clearInterval(pingInterval);
        sub.unsubscribe();
        res.end();
      }
    });

    const pingInterval = setInterval(() => {
      if (!closed) {
        res.write(`: ping\n\n`);
      }
    }, 1000);

    req.on('close', () => {
      closed = true;
      clearInterval(pingInterval);
      sub.unsubscribe();
    });
  }

  /**
   * GET /api/file/:filename - Phục vụ file kết quả tải về từ DOWNLOAD_DIR (hỗ trợ Range 206)
   */
  @Get('file/:filename')
  async serveFile(
    @Param('filename') rawFilename: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let unescaped = rawFilename;
    try {
      unescaped = decodeURIComponent(rawFilename);
    } catch {
      throw new BadRequestException('Đường dẫn file không hợp lệ.');
    }

    if (
      !unescaped ||
      unescaped === '.' ||
      unescaped === '/' ||
      unescaped.includes('..') ||
      unescaped.includes('/') ||
      unescaped.includes('\\') ||
      unescaped.includes('\0') ||
      unescaped.includes('\r') ||
      unescaped.includes('\n')
    ) {
      throw new BadRequestException('Tên file không hợp lệ.');
    }

    const safeFilename = path.basename(unescaped);
    const downloadDir = path.resolve(process.env.DOWNLOAD_DIR || '/app/downloads');
    const filePath = path.resolve(downloadDir, safeFilename);

    if (!filePath.startsWith(downloadDir + path.sep)) {
      throw new BadRequestException('Yêu cầu không hợp lệ.');
    }

    if (!fs.existsSync(filePath)) {
      const proxied = await this.tryProxyFileFromWorkers(safeFilename, filePath);
      if (!proxied && !fs.existsSync(filePath)) {
        throw new TaskFileNotFoundException(safeFilename);
      }
    }

    let displayName = safeFilename;
    if (safeFilename.includes('_')) {
      const idx = safeFilename.indexOf('_');
      displayName = safeFilename.slice(idx + 1) || safeFilename;
    }

    const cleanDisplayName = displayName.replace(/[\x00-\x1f\x7f"\\]/g, '_');
    const encodedName = encodeURIComponent(displayName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${cleanDisplayName}"; filename*=UTF-8''${encodedName}`,
    );

    const ext = path.extname(displayName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.vtt': 'text/vtt; charset=utf-8',
      '.srt': 'text/plain; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.webm': 'video/webm',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);

    res.sendFile(filePath, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${cleanDisplayName}"; filename*=UTF-8''${encodedName}`,
      },
    });
  }

  private async tryProxyFileFromWorkers(filename: string, destPath: string): Promise<boolean> {
    const workerCandidates = [
      process.env.WORKER_WHISPER_URL,
      process.env.WORKER_WHISPER_FALLBACK_URL,
      process.env.WORKER_RMBG_URL,
      process.env.WORKER_RMBG_FALLBACK_URL,
      process.env.WORKER_UPSCALER_URL,
      process.env.WORKER_PIXELFIXER_URL,
    ].filter((u): u is string => Boolean(u));

    for (const workerUrl of workerCandidates) {
      try {
        const target = `${workerUrl.replace(/\/$/, '')}/api/file/${encodeURIComponent(filename)}`;
        const resp = await fetch(target, { method: 'GET' });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, buf);
          return true;
        }
      } catch {
        // try next worker
      }
    }
    return false;
  }
}

import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AiWorkerPort } from '../../domain/ports/ai-worker.port';
import {
  parseMultipartRequest,
  buildMultipartBuffer,
  readRawBody,
} from '../../../../common/utils/multipart.util';
import * as path from 'path';

const ALLOWED_TRANSCRIBE_EXTS = new Set([
  '.mp3', '.mp4', '.wav', '.m4a',
  '.webm', '.flac', '.ogg', '.aac',
  '.mov', '.avi', '.mkv',
]);
const ALLOWED_TRANSCRIBE_FORMATS = new Set(['txt', 'srt', 'vtt', 'json']);
const ALLOWED_TRANSCRIBE_TASKS = new Set(['transcribe', 'translate']);
const ALLOWED_RMBG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

@Injectable()
export class HttpAiWorkerAdapter implements AiWorkerPort {
  private getServiceUrl(service: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): string {
    switch (service) {
      case 'pixelfixer':
        return (process.env.WORKER_PIXELFIXER_URL || 'http://tasks.worker-pixelfixer:8004').replace(/\/$/, '');
      case 'upscaler':
        return (process.env.WORKER_UPSCALER_URL || 'http://tasks.worker-upscaler:8006').replace(/\/$/, '');
      case 'whisper':
        return (process.env.WORKER_WHISPER_URL || 'http://tasks.worker-whisper:8002').replace(/\/$/, '');
      case 'rmbg':
        return (process.env.WORKER_RMBG_URL || 'http://tasks.worker-rmbg:8003').replace(/\/$/, '');
    }
  }

  private getCandidateUrls(service: 'whisper' | 'rmbg'): string[] {
    if (service === 'whisper') {
      const localUrl = 'http://tasks.worker-whisper:8002';
      const primary = (process.env.WORKER_WHISPER_URL || localUrl).replace(/\/$/, '');
      const fallback = (process.env.WORKER_WHISPER_FALLBACK_URL || localUrl).replace(/\/$/, '');
      return [primary, localUrl, localUrl, fallback];
    }
    const localUrl = 'http://tasks.worker-rmbg:8003';
    const primary = (process.env.WORKER_RMBG_URL || localUrl).replace(/\/$/, '');
    const fallback = (process.env.WORKER_RMBG_FALLBACK_URL || localUrl).replace(/\/$/, '');
    return [primary, localUrl, localUrl, fallback];
  }

  async checkHealth(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): Promise<any> {
    const url = this.getServiceUrl(serviceName);
    try {
      const resp = await fetch(`${url}/health`, { method: 'GET' });
      if (resp.ok) {
        return await resp.json();
      }
      return { status: 'degraded', service: `worker-${serviceName}` };
    } catch (err: any) {
      return { status: 'down', service: `worker-${serviceName}`, error: err.message };
    }
  }

  async handleTranscribe(req: Request, res: Response): Promise<void> {
    const { fields, files } = await parseMultipartRequest(req, 250 * 1024 * 1024);
    const file = files['file'];
    if (!file || !file.filename) {
      throw new BadRequestException("Không tìm thấy file tải lên (tham số 'file').");
    }

    let originalFilename = path.basename(file.filename.replace(/\\/g, '/'));
    if (!originalFilename || originalFilename === '.' || originalFilename === '/') {
      originalFilename = 'media';
    }
    const ext = path.extname(originalFilename).toLowerCase();
    if (!ALLOWED_TRANSCRIBE_EXTS.has(ext)) {
      throw new BadRequestException(
        `Định dạng file '${ext}' không được hỗ trợ để nhận diện giọng nói. Vui lòng tải file audio/video.`,
      );
    }

    const language = (fields['language'] || 'auto').trim().toLowerCase() || 'auto';
    const format = (fields['format'] || 'txt').trim().toLowerCase() || 'txt';
    const task = (fields['task'] || 'transcribe').trim().toLowerCase() || 'transcribe';

    if (!ALLOWED_TRANSCRIBE_FORMATS.has(format)) {
      throw new BadRequestException(
        `Định dạng xuất '${format}' không hợp lệ. Các định dạng hợp lệ: txt, srt, vtt, json.`,
      );
    }
    if (!ALLOWED_TRANSCRIBE_TASKS.has(task)) {
      throw new BadRequestException(
        `Tác vụ '${task}' không hợp lệ. Các tác vụ hợp lệ: transcribe, translate.`,
      );
    }

    const { body, contentType } = buildMultipartBuffer(
      { language, format, task },
      {
        fieldname: 'file',
        filename: originalFilename,
        contentType: file.contentType,
        data: file.data,
      },
    );

    const candidates = this.getCandidateUrls('whisper');
    for (const workerUrl of candidates) {
      try {
        const resp = await fetch(`${workerUrl}/api/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: new Uint8Array(body),
        });
        const text = await resp.text();
        let jsonData: any;
        try {
          jsonData = JSON.parse(text);
          if (resp.status >= 400 && jsonData && jsonData.success === undefined) {
            jsonData.success = false;
          }
        } catch {
          jsonData = { success: false, detail: text };
        }
        if (resp.status === 200 || resp.status === 400) {
          res.status(resp.status).json(jsonData);
          return;
        }
      } catch {
        // try next fallback worker
      }
    }

    throw new ServiceUnavailableException(
      'Dịch vụ nhận diện giọng nói hiện đang bận hoặc không khả dụng. Vui lòng thử lại sau giây lát.',
    );
  }

  async handleRemoveBackground(req: Request, res: Response): Promise<void> {
    const { fields, files } = await parseMultipartRequest(req, 50 * 1024 * 1024);
    const file = files['file'];
    if (!file || !file.filename) {
      throw new BadRequestException("Không tìm thấy file tải lên (tham số 'file').");
    }

    let originalFilename = path.basename(file.filename.replace(/\\/g, '/'));
    if (!originalFilename || originalFilename === '.' || originalFilename === '/') {
      originalFilename = 'image.png';
    }
    const ext = path.extname(originalFilename).toLowerCase();
    if (!ALLOWED_RMBG_EXTS.has(ext)) {
      throw new BadRequestException(
        `Định dạng file '${ext}' không được hỗ trợ để tách nền. Vui lòng tải file ảnh (PNG, JPG, WEBP).`,
      );
    }

    const model = fields['model'] || 'General-Use';
    const threshold = fields['threshold'] || '0.5';
    const returnMask = fields['return_mask'] || 'false';

    const { body, contentType } = buildMultipartBuffer(
      {
        model,
        threshold,
        return_mask: returnMask,
        response_as_base64: 'true',
      },
      {
        fieldname: 'file',
        filename: originalFilename,
        contentType: file.contentType,
        data: file.data,
      },
    );

    const candidates = this.getCandidateUrls('rmbg');
    for (const workerUrl of candidates) {
      try {
        const resp = await fetch(`${workerUrl}/api/remove-bg`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: new Uint8Array(body),
        });
        const text = await resp.text();
        let jsonData: any;
        try {
          jsonData = JSON.parse(text);
          if (resp.status >= 400 && jsonData && jsonData.success === undefined) {
            jsonData.success = false;
          }
        } catch {
          jsonData = { success: false, detail: text };
        }
        if (resp.status === 200 || resp.status === 400) {
          res.status(resp.status).json(jsonData);
          return;
        }
      } catch {
        // try next fallback worker
      }
    }

    throw new ServiceUnavailableException(
      'Dịch vụ tách nền AI hiện không khả dụng. Vui lòng thử lại sau.',
    );
  }

  async forwardRawStream(
    serviceName: 'pixelfixer' | 'upscaler',
    targetPath: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.status(405).json({
        success: false,
        detail: 'Method not allowed',
      });
      return;
    }

    const baseUrl = this.getServiceUrl(serviceName);
    const queryIdx = req.originalUrl.indexOf('?');
    const queryStr = queryIdx !== -1 ? req.originalUrl.slice(queryIdx) : '';
    const finalUrl = `${baseUrl}${targetPath}${queryStr}`;

    const rawBody = await readRawBody(req, 50 * 1024 * 1024);
    const headers: Record<string, string> = {};
    if (req.headers['content-type']) {
      headers['Content-Type'] = String(req.headers['content-type']);
    }
    if (req.headers['traceparent']) {
      headers['traceparent'] = String(req.headers['traceparent']);
    }

    let resp: globalThis.Response;
    try {
      resp = await fetch(finalUrl, {
        method: 'POST',
        headers,
        body: new Uint8Array(rawBody),
      });
    } catch (err: any) {
      res.status(502).json({
        success: false,
        detail: `Không thể kết nối tới worker (${serviceName}): ${err.message}`,
        error: `Không thể kết nối tới worker (${serviceName}): ${err.message}`,
      });
      return;
    }

    resp.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k !== 'transfer-encoding' && k !== 'content-encoding' && k !== 'content-length') {
        res.setHeader(key, value);
      }
    });

    const respBuf = Buffer.from(await resp.arrayBuffer());
    const respCt = resp.headers.get('content-type') || '';
    if (resp.status >= 400 && respCt.includes('application/json')) {
      try {
        const parsed = JSON.parse(respBuf.toString('utf-8'));
        if (parsed && typeof parsed === 'object' && parsed.success === undefined) {
          parsed.success = false;
          res.status(resp.status).json(parsed);
          return;
        }
      } catch {
        // send raw buffer below
      }
    }

    res.status(resp.status).send(respBuf);
  }
}

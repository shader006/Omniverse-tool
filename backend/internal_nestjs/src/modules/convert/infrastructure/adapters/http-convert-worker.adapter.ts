import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConvertWorkerPort } from '../../domain/ports/convert-worker.port';
import {
  parseMultipartRequest,
  buildMultipartBuffer,
} from '../../../../common/utils/multipart.util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const ALLOWED_CONVERT_EXTS = new Set([
  '.docx', '.doc',
  '.xlsx', '.xls',
  '.pptx', '.ppt',
  '.odt', '.ods', '.odp',
  '.rtf', '.txt', '.csv',
  '.pdf',
]);

function formatBytes(b: number): string {
  const unit = 1024;
  if (b < unit) return `${b} B`;
  let div = unit;
  let exp = 0;
  for (let n = Math.floor(b / unit); n >= unit; n = Math.floor(n / unit)) {
    div *= unit;
    exp++;
  }
  return `${(b / div).toFixed(1)} ${'KMGTPE'[exp]}B`;
}

function randomShortId(): string {
  return crypto.randomBytes(4).toString('hex');
}

function sanitizeBaseName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/^[._\-\s]+|[._\-\s]+$/g, '');
  return cleaned || 'document';
}

@Injectable()
export class HttpConvertWorkerAdapter implements ConvertWorkerPort {
  private getGotenbergUrl(): string {
    return (process.env.GOTENBERG_URL || 'http://tasks.gotenberg:3000').replace(/\/$/, '');
  }

  private getPdf2DocxUrl(): string {
    return (process.env.WORKER_PDF2DOCX_URL || 'http://tasks.worker-pdf2docx:8005').replace(/\/$/, '');
  }

  private getDownloadDir(): string {
    return process.env.DOWNLOAD_DIR || '/app/downloads';
  }

  private validateMagicBytes(ext: string, headerBytes: Buffer): void {
    if (!headerBytes || headerBytes.length === 0) {
      throw new BadRequestException('File tải lên rỗng (0 bytes). Vui lòng chọn file có dữ liệu.');
    }

    const headStr = headerBytes.subarray(0, 128).toString('latin1');
    switch (ext) {
      case '.pdf': {
        if (!headerBytes.includes(Buffer.from('%PDF-'))) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: thiếu header %PDF- chuẩn (nghi ngờ giả mạo đuôi file)',
          );
        }
        const polyglotPrefixes = ['<svg', '<?xml', '<!DOCTYPE', '<html', '<script', '#!/bin', '\x7fELF', 'MZ'];
        if (polyglotPrefixes.some((p) => headStr.startsWith(p))) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: phát hiện định dạng polyglot nguy hiểm đội lốt file PDF',
          );
        }
        break;
      }
      case '.docx':
      case '.xlsx':
      case '.pptx':
      case '.odt':
      case '.ods':
      case '.odp': {
        if (headerBytes.length < 4 || !headerBytes.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'binary'))) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: thiếu chữ ký ZIP container (PK) của tài liệu Office',
          );
        }
        break;
      }
      case '.doc':
      case '.xls':
      case '.ppt': {
        const oleMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        if (headerBytes.length < 8 || !headerBytes.subarray(0, 8).equals(oleMagic)) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: thiếu chữ ký OLE2 compound header của tài liệu Office cũ',
          );
        }
        break;
      }
      case '.rtf': {
        if (!headStr.startsWith('{\\rtf')) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: thiếu chữ ký chuẩn của tài liệu Rich Text Format (RTF)',
          );
        }
        break;
      }
      case '.txt':
      case '.csv': {
        const dangerousTextPrefixes = ['MZ', '\x7fELF', '<!DOCTYPE', '<html', '<script', '<svg'];
        if (dangerousTextPrefixes.some((p) => headStr.startsWith(p))) {
          throw new BadRequestException(
            'Xác thực nội dung file thất bại: phát hiện nội dung mã thực thi hoặc HTML/Script trong file văn bản',
          );
        }
        break;
      }
    }
  }

  async convertMultipartRequest(req: Request): Promise<any> {
    const { fields, files } = await parseMultipartRequest(req, 100 * 1024 * 1024);
    const file = files['file'];
    if (!file || !file.filename) {
      throw new BadRequestException("Không tìm thấy file tải lên (tham số 'file').");
    }

    if (file.data.length === 0) {
      throw new BadRequestException('File tải lên rỗng (0 bytes). Vui lòng chọn file có dữ liệu.');
    }

    let originalFilename = path.basename(file.filename.replace(/\\/g, '/'));
    if (!originalFilename || originalFilename === '.' || originalFilename === '/') {
      originalFilename = 'document';
    }

    const ext = path.extname(originalFilename).toLowerCase();
    const baseNameWithoutExt = path.basename(originalFilename, path.extname(originalFilename)) || 'document';

    if (!ALLOWED_CONVERT_EXTS.has(ext)) {
      throw new BadRequestException(
        `Định dạng file '${ext}' không được hỗ trợ để chuyển đổi. Vui lòng chỉ tải lên tài liệu văn phòng hợp lệ (.pdf, .docx, .doc, .xlsx, .xls, .pptx, .ppt, .csv, .txt, .rtf, .odt...).`,
      );
    }

    const headerSlice = file.data.subarray(0, Math.min(512, file.data.length));
    this.validateMagicBytes(ext, headerSlice);

    const landscape = fields['landscape'] === 'true';
    const pdfa = fields['pdfa'] || '';
    let targetFormat = (fields['target_format'] || '').trim().toLowerCase();
    if (!targetFormat) {
      if (ext === '.pdf' && !pdfa && !landscape) {
        targetFormat = 'docx';
      } else {
        targetFormat = 'pdf';
      }
    }

    const downloadDir = this.getDownloadDir();
    fs.mkdirSync(downloadDir, { recursive: true });
    const safeBase = sanitizeBaseName(baseNameWithoutExt);

    if (ext === '.pdf' && targetFormat === 'docx') {
      const targetFont = fields['target_font'] || '';
      const extraFields: Record<string, string> = {};
      if (targetFont) extraFields['target_font'] = targetFont;

      const { body, contentType } = buildMultipartBuffer(extraFields, {
        fieldname: 'file',
        filename: originalFilename,
        contentType: 'application/pdf',
        data: file.data,
      });

      let resp: Response;
      try {
        resp = await fetch(`${this.getPdf2DocxUrl()}/convert`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: new Uint8Array(body),
        });
      } catch {
        throw new ServiceUnavailableException(
          'Không thể kết nối tới dịch vụ chuyển đổi PDF sang Word (worker_pdf2docx).',
        );
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new BadRequestException(`Chuyển đổi PDF sang Word thất bại: ${errText}`);
      }

      const outBuf = Buffer.from(await resp.arrayBuffer());
      const outFilename = `${randomShortId()}_${safeBase}.docx`;
      const outPath = path.join(downloadDir, outFilename);
      fs.writeFileSync(outPath, outBuf);

      return {
        success: true,
        filename: outFilename,
        original_filename: originalFilename,
        output_filename: `${baseNameWithoutExt}.docx`,
        download_url: `/api/file/${outFilename}`,
        size: outBuf.length,
        size_str: formatBytes(outBuf.length),
      };
    }

    // Office/Text -> PDF via Gotenberg
    const gotenbergFields: Record<string, string> = {};
    if (landscape) gotenbergFields['landscape'] = 'true';
    if (pdfa) gotenbergFields['pdfa'] = pdfa;

    const { body, contentType } = buildMultipartBuffer(gotenbergFields, {
      fieldname: 'files',
      filename: originalFilename,
      contentType: file.contentType,
      data: file.data,
    });

    let resp: Response;
    try {
      resp = await fetch(`${this.getGotenbergUrl()}/forms/libreoffice/convert`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(body),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Không thể kết nối tới Gotenberg service. Vui lòng kiểm tra container Gotenberg.',
      );
    }

    if (!resp.ok) {
      const respStr = await resp.text();
      if (
        respStr.includes('failed to convert the document') ||
        respStr.includes('uno exception') ||
        respStr.includes('syntax error')
      ) {
        throw new UnprocessableEntityException(
          'Tài liệu không hợp lệ hoặc cấu trúc file bị lỗi/hỏng, không thể chuyển đổi sang PDF.',
        );
      }
      throw new InternalServerErrorException(`Gotenberg chuyển đổi thất bại: ${respStr}`);
    }

    const outBuf = Buffer.from(await resp.arrayBuffer());
    const outFilename = `${randomShortId()}_${safeBase}.pdf`;
    const outPath = path.join(downloadDir, outFilename);
    fs.writeFileSync(outPath, outBuf);

    return {
      success: true,
      filename: outFilename,
      original_filename: originalFilename,
      output_filename: `${baseNameWithoutExt}.pdf`,
      download_url: `/api/file/${outFilename}`,
      size: outBuf.length,
      size_str: formatBytes(outBuf.length),
    };
  }
}

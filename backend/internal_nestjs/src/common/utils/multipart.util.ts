import { Request } from 'express';
import { BadRequestException } from '@nestjs/common';

export interface UploadedMultipartFile {
  fieldname: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipartForm {
  fields: Record<string, string>;
  files: Record<string, UploadedMultipartFile>;
}

export async function readRawBody(req: Request, maxBytes: number = 50 * 1024 * 1024): Promise<Buffer> {
  if (Buffer.isBuffer((req as any).body)) {
    return (req as any).body;
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new BadRequestException(`Kích thước dữ liệu tải lên vượt quá giới hạn cho phép (${Math.round(maxBytes / (1024 * 1024))}MB).`));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export async function parseMultipartRequest(
  req: Request,
  maxBytes: number = 100 * 1024 * 1024,
): Promise<ParsedMultipartForm> {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;,\s]+))/i);
  if (!match) {
    throw new BadRequestException('Không tìm thấy file tải lên (tham số \'file\') hoặc định dạng multipart không hợp lệ.');
  }

  const boundaryStr = match[1] || match[2];
  const rawBody = await readRawBody(req, maxBytes);

  const fields: Record<string, string> = {};
  const files: Record<string, UploadedMultipartFile> = {};

  const boundaryBuf = Buffer.from(`--${boundaryStr}`);
  const crlfCrlf = Buffer.from('\r\n\r\n');

  let pos = rawBody.indexOf(boundaryBuf);
  while (pos !== -1) {
    const partStart = pos + boundaryBuf.length;
    if (rawBody.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) {
      break;
    }

    let contentStart = partStart;
    if (rawBody.subarray(contentStart, contentStart + 2).equals(Buffer.from('\r\n'))) {
      contentStart += 2;
    } else if (rawBody[contentStart] === 0x0a) {
      contentStart += 1;
    }

    const nextBoundary = rawBody.indexOf(boundaryBuf, contentStart);
    if (nextBoundary === -1) {
      break;
    }

    let partEnd = nextBoundary;
    if (partEnd >= 2 && rawBody[partEnd - 2] === 0x0d && rawBody[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    } else if (partEnd >= 1 && rawBody[partEnd - 1] === 0x0a) {
      partEnd -= 1;
    }

    const partBuf = rawBody.subarray(contentStart, partEnd);
    const headerEnd = partBuf.indexOf(crlfCrlf);
    if (headerEnd !== -1) {
      const headerStr = partBuf.subarray(0, headerEnd).toString('utf-8');
      const bodyBuf = partBuf.subarray(headerEnd + 4);

      const nameMatch = headerStr.match(/name="([^"]+)"/i);
      const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
      const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n;]+)/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch !== null && filenameMatch !== undefined) {
          files[fieldName] = {
            fieldname: fieldName,
            filename: filenameMatch[1],
            contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
            data: bodyBuf,
          };
        } else {
          fields[fieldName] = bodyBuf.toString('utf-8');
        }
      }
    }

    pos = nextBoundary;
  }

  return { fields, files };
}

export function buildMultipartBuffer(
  fields: Record<string, string>,
  fileField?: { fieldname: string; filename: string; contentType?: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----OmniverseNestBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
        'utf-8',
      ),
    );
  }

  if (fileField) {
    const ct = fileField.contentType || 'application/octet-stream';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.fieldname}"; filename="${fileField.filename}"\r\nContent-Type: ${ct}\r\n\r\n`,
        'utf-8',
      ),
    );
    chunks.push(fileField.data);
    chunks.push(Buffer.from('\r\n', 'utf-8'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}


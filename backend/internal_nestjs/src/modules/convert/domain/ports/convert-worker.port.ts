import { Request } from 'express';

export interface ConvertWorkerPort {
  convertMultipartRequest(req: Request): Promise<any>;
}

import { Request, Response } from 'express';

export interface AiWorkerPort {
  checkHealth(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): Promise<any>;
  handleTranscribe(req: Request, res: Response): Promise<void>;
  handleRemoveBackground(req: Request, res: Response): Promise<void>;
  forwardRawStream(
    serviceName: 'pixelfixer' | 'upscaler',
    targetPath: string,
    req: Request,
    res: Response,
  ): Promise<void>;
}

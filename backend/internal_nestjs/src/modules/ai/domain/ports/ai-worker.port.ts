export interface AiWorkerPort {
  checkHealth(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg'): Promise<{ status: string; service: string }>;
  proxyPost(serviceName: 'pixelfixer' | 'upscaler' | 'whisper' | 'rmbg', path: string, body: any): Promise<any>;
}

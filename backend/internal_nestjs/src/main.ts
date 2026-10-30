import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildGatewayHealthResponse } from './app.controller';
import { DomainExceptionFilter } from './core/filters/domain-exception.filter';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cho phép CORS cho Frontend
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  // Đăng ký Global Exception Filter
  app.useGlobalFilters(new DomainExceptionFilter());

  // Xác định thư mục Frontend (chứa dist hoặc bundle Vite/React)
  const rawFrontendDir = process.env.FRONTEND_DIR || '/frontend';
  let frontendDir = rawFrontendDir;
  if (fs.existsSync(path.join(rawFrontendDir, 'dist', 'index.html'))) {
    frontendDir = path.join(rawFrontendDir, 'dist');
  }

  // Helper kiểm tra file nhạy cảm và dotfiles
  const isDangerousStaticPath = (p: string): boolean => {
    const clean = p.toLowerCase();
    if (clean.includes('..') || clean.includes('\0') || clean.includes('%00')) return true;
    for (const segment of clean.split('/')) {
      const seg = segment.trim();
      if (seg.startsWith('.') && seg !== '.') return true;
    }
    const blockedExact = [
      'package.json', 'package-lock.json', 'tsconfig.json', 'docker-compose.yml',
      'docker-stack.yml', 'appsettings.json', 'stripe-keys.json', 'master.key',
      'credentials', 'passwd', 'shadow', 'access.log', 'error.log', 'dockerfile',
      'vite.config.js', 'vite.config.ts'
    ];
    const base = path.basename(clean);
    if (blockedExact.includes(base)) return true;
    if (['/wp-', '/phpmyadmin', '/admin', '/actuator', '/etc/', '/var/'].some(prefix => clean.includes(prefix))) return true;
    const blockedExts = [
      '.go', '.py', '.sh', '.ts', '.tsx', '.env', '.lock', '.php', '.key',
      '.pem', '.crt', '.bak', '.sql', '.log', '.yml', '.yaml', '.ini',
      '.conf', '.config', '.rb', '.asp', '.aspx', '.jsp', '.cgi'
    ];
    return blockedExts.includes(path.extname(base));
  };

  const expressApp = app.getHttpAdapter().getInstance();

  // Bảo vệ chống Path Traversal & Null-byte trên /api/file/* trước khi đi vào router
  expressApp.use((req: any, res: any, next: any) => {
    const rawUrl: string = req.originalUrl || req.url || '';
    if (rawUrl.startsWith('/api/file/')) {
      const rawFilePart = rawUrl.slice('/api/file/'.length).split('?')[0];
      const lowerRaw = rawFilePart.toLowerCase();
      if (
        lowerRaw.includes('%00') ||
        lowerRaw.includes('%2f') ||
        lowerRaw.includes('%5c') ||
        lowerRaw.includes('%2e%2e') ||
        rawFilePart.includes('..') ||
        rawFilePart.includes('/') ||
        rawFilePart.includes('\\')
      ) {
        return res.status(400).json({
          success: false,
          detail: 'Tên file hoặc đường dẫn không hợp lệ.',
        });
      }
      try {
        const decoded = decodeURIComponent(rawFilePart);
        if (
          !decoded ||
          decoded === '.' ||
          decoded === '/' ||
          decoded.includes('..') ||
          decoded.includes('/') ||
          decoded.includes('\\') ||
          decoded.includes('\0') ||
          decoded.includes('\r') ||
          decoded.includes('\n')
        ) {
          return res.status(400).json({
            success: false,
            detail: 'Tên file không hợp lệ.',
          });
        }
      } catch {
        return res.status(400).json({
          success: false,
          detail: 'Đường dẫn file không hợp lệ.',
        });
      }
    }
    next();
  });

  // Endpoint /health ở root (song song với /api/health)
  expressApp.get('/health', async (_req: any, res: any) => {
    const data = await buildGatewayHealthResponse();
    res.status(200).json(data);
  });

  // Chặn truy cập file nhạy cảm trên /static và /models
  expressApp.use('/static', (req: any, res: any, next: any) => {
    if (isDangerousStaticPath(req.path)) {
      return res.status(404).send('404 Not Found');
    }
    next();
  });

  // Phục vụ static assets từ frontendDir, rawFrontendDir và các thư mục con
  app.use(express.static(frontendDir));
  const staticCandidates = [
    frontendDir,
    path.join(frontendDir, 'assets'),
    path.join(rawFrontendDir, 'client'),
    path.join(rawFrontendDir, 'ui'),
    rawFrontendDir,
  ];
  for (const dir of staticCandidates) {
    if (fs.existsSync(dir)) {
      app.use('/static', express.static(dir));
    }
  }

  // Phục vụ models tĩnh nếu có
  const modelsCandidates = [
    '/models',
    path.join(rawFrontendDir, 'models'),
    path.join(frontendDir, 'models'),
  ];
  for (const mDir of modelsCandidates) {
    if (fs.existsSync(mDir)) {
      app.use('/models', express.static(mDir));
    }
  }

  // Thiết lập tiền tố toàn cục /api cho API endpoints
  app.setGlobalPrefix('api');

  // SPA Fallback: chuyển request hợp lệ về index.html của Frontend, từ chối file nhạy cảm
  expressApp.get('*', (req: any, res: any, next: any) => {
    const rawUrl: string = req.originalUrl || req.url || '';
    if (req.path.startsWith('/api') || req.path === '/health' || rawUrl.startsWith('/api/')) {
      return next();
    }
    if (isDangerousStaticPath(req.path) || isDangerousStaticPath(rawUrl)) {
      return res.status(404).send('404 Not Found');
    }
    const indexPath = path.join(frontendDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      return res.sendFile(indexPath);
    }
    next();
  });

  const port = process.env.PORT || 8000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 NestJS Gateway (Hexagonal DDD Architecture) is running on port ${port}`);
  console.log(`📂 Frontend Static & SPA Dir: ${frontendDir}`);
}

bootstrap();

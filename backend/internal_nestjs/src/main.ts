import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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

  // Đăng ký Domain Exception Filter
  app.useGlobalFilters(new DomainExceptionFilter());

  // Xác định thư mục Frontend (chứa dist hoặc bundle Vite/React)
  let frontendDir = process.env.FRONTEND_DIR || '/frontend';
  if (fs.existsSync(path.join(frontendDir, 'dist', 'index.html'))) {
    frontendDir = path.join(frontendDir, 'dist');
  }

  // Phục vụ static assets từ frontendDir và thư mục static
  app.use(express.static(frontendDir));
  app.use('/static', express.static(frontendDir));

  // Phục vụ models tĩnh nếu có
  const modelsDir = fs.existsSync('/models') ? '/models' : path.join(frontendDir, 'models');
  if (fs.existsSync(modelsDir)) {
    app.use('/models', express.static(modelsDir));
  }

  // Thiết lập tiền tố toàn cục /api cho API endpoints (ngoại trừ /health)
  app.setGlobalPrefix('api', {
    exclude: ['health'],
  });

  // SPA Fallback: chuyển mọi request trang web về index.html của Frontend
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('*', (req: any, res: any, next: any) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
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

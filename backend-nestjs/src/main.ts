import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Bat CORS cho frontend React goi API
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Tu dong validate DTO voi class-validator
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Prefix chung cho tat ca API
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log('Oniverse NestJS Backend dang chay tai http://localhost:' + port);
  console.log('API Base URL: http://localhost:' + port + '/api/v1');
}

bootstrap();
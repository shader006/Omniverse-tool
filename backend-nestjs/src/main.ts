import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Cookie Parser middleware
  app.use(cookieParser(process.env.COOKIE_SECRET || 'oniverse-cookie-secret'));

  // Express Session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'oniverse-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngay
      },
    }),
  );

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
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('App & Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('/api/v1 (GET) - Tra ve thong tin he thong', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1')
      .expect(200);

    expect(res.body.project).toBe('Oniverse - Multi Media & AI Tools');
  });

  it('/api/v1/auth/login (POST) - Dang nhap voi token demo thanh cong', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        idToken: 'demo.test-uid-123.nguyenvana',
        userAgent: 'Vitest-E2E-Agent',
      })
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.body.user.firebaseUid).toBe('test-uid-123');
    expect(res.body.session).toBeDefined();
    expect(res.body.session.status).toBe('active');

    const sessionId = res.body.session.id;

    // Kiem tra xac minh phien
    const verifyRes = await request(app.getHttpServer())
      .get(`/api/v1/auth/session/${sessionId}/verify`)
      .expect(200);
    expect(verifyRes.body.valid).toBe(true);

    // Kiem tra GET /api/v1/auth/me voi header x-session-id
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('x-session-id', sessionId)
      .expect(200);
    expect(meRes.body.user.firebaseUid).toBe('test-uid-123');

    // Dang xuat
    const logoutRes = await request(app.getHttpServer())
      .post(`/api/v1/auth/logout/${sessionId}`)
      .expect(200);
    expect(logoutRes.body.message).toContain('thanh cong');
  });

  afterEach(async () => {
    await app.close();
  });
});

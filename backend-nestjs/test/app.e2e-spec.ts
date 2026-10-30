import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('App, Auth & Users (e2e)', () => {
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

  it('/api/v1/auth/login (POST) - Dang nhap, xac minh phien, getMe va dang xuat', async () => {
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
    const userId = res.body.user.id;

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

    // Kiem tra GET /api/v1/auth/me voi Authorization Bearer token
    const meBearerRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer demo.test-uid-123.nguyenvana')
      .expect(200);
    expect(meBearerRes.body.user.firebaseUid).toBe('test-uid-123');

    // Lay tat ca phien dang nhap cua user
    const sessionsRes = await request(app.getHttpServer())
      .get(`/api/v1/auth/sessions/user/${userId}`)
      .expect(200);
    expect(Array.isArray(sessionsRes.body)).toBe(true);
    expect(sessionsRes.body.length).toBeGreaterThanOrEqual(1);

    // Dang xuat
    const logoutRes = await request(app.getHttpServer())
      .post(`/api/v1/auth/logout/${sessionId}`)
      .expect(200);
    expect(logoutRes.body.message).toContain('thanh cong');

    // Sau khi dang xuat, verify phai tra ve valid: false
    const verifyAfterLogout = await request(app.getHttpServer())
      .get(`/api/v1/auth/session/${sessionId}/verify`)
      .expect(200);
    expect(verifyAfterLogout.body.valid).toBe(false);
  });

  it('/api/v1/auth/* - Xu ly loi xac thuc (token sai, chua dang nhap)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ idToken: 'invalid-token-format' })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout/non-existent-session-id')
      .expect(401);
  });

  it('/api/v1/users (CRUD) - Quan ly danh sach, cap nhat ten, ngon ngu va xoa nguoi dung', async () => {
    // Tao user qua login demo
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        idToken: 'demo.crud-uid-999.tranvanb',
        userAgent: 'Vitest-CRUD-Test',
      })
      .expect(200);

    const userId = loginRes.body.user.id;

    // 1. GET /api/v1/users
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .expect(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.some((u: any) => u.id === userId)).toBe(true);

    // 2. GET /api/v1/users/:id
    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/users/${userId}`)
      .expect(200);
    expect(detailRes.body.firebaseUid).toBe('crud-uid-999');

    // 3. PATCH /api/v1/users/:id
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/users/${userId}`)
      .send({ username: 'Tran Van B Updated' })
      .expect(200);
    expect(updateRes.body.username).toBe('Tran Van B Updated');

    // 4. PATCH /api/v1/users/:id/language
    const langRes = await request(app.getHttpServer())
      .patch(`/api/v1/users/${userId}/language`)
      .send({ lang: 'en' })
      .expect(200);
    expect(langRes.body.currentLanguage).toBe('en');

    // 5. DELETE /api/v1/users/:id
    await request(app.getHttpServer())
      .delete(`/api/v1/users/${userId}`)
      .expect(204);

    // 6. Kiem tra GET sau khi xoa -> 404
    await request(app.getHttpServer())
      .get(`/api/v1/users/${userId}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});

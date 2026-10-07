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

  it('/api/v1/auth/register & /login-jwt & /profile (POST, GET) - Chuan NestJS JWT Authentication', async () => {
    const testEmail = `student_${Date.now()}@phenikaa.edu.vn`;
    const testPass = 'Student@123';
    const testUsername = 'NguyenVanA';

    // 1. Dang ky tai khoan moi
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: testPass,
        username: testUsername,
      })
      .expect(201);

    expect(regRes.body.message).toContain('Đăng ký tài khoản thành công');
    expect(regRes.body.access_token).toBeDefined();
    expect(regRes.body.user).toBeDefined();
    expect(regRes.body.user.email).toBe(testEmail);
    expect(regRes.body.user.password).toBeUndefined(); // Mật khẩu không bị lộ

    // 2. Dang nhap voi Email & Password
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: testPass,
      })
      .expect(200);

    expect(loginRes.body.message).toContain('Đăng nhập thành công');
    expect(loginRes.body.access_token).toBeDefined();
    const token = loginRes.body.access_token;

    // 3. Truy cap route bao ve /profile khi khong co token -> 401 Unauthorized
    await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .expect(401);

    // 4. Truy cap route bao ve /profile voi Bearer token hop le -> 200 OK
    const profileRes = await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(profileRes.body.message).toContain('Xác thực JWT thành công');
    expect(profileRes.body.user).toBeDefined();
    expect(profileRes.body.user.email).toBe(testEmail);
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
    if (app) {
      await app.close();
    }
  });
});

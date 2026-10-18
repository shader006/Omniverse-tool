import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../backend-nestjs/src/app.module.js';

describe('Firebase Auth & User Management - E2E Tests (E-01 -> E-25)', () => {
  let app: INestApplication<App>;
  let server: any;

  // Dữ liệu phiên chạy: uid và email duy nhất để tránh xung đột UNIQUE constraint
  const uniqueKey = `e2e_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const demoToken = `demo.${uniqueKey}.${uniqueKey}`;
  let activeSessionId: string;
  let activeUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ─── 1. HỆ THỐNG CƠ BẢN ──────────────────────────────────────────────────
  describe('E-01: GET /api/v1 - Thông tin hệ thống', () => {
    it('phải trả về 200 OK và thông tin dự án Oniverse', async () => {
      const res = await request(server).get('/api/v1').expect(200);
      expect(res.body.project).toBe('Oniverse - Multi Media & AI Tools');
      expect(res.body.version).toBe('1.0.0');
    });
  });

  // ─── 2. ĐĂNG NHẬP FIREBASE ──────────────────────────────────────────────
  describe('E-02 -> E-07: POST /api/v1/auth/login', () => {
    it('E-02: Đăng nhập thành công với Demo Token hợp lệ', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({
          idToken: demoToken,
          userAgent: 'Vitest-E2E-Agent/1.0',
        })
        .expect(200);

      expect(res.body.message).toContain('Xin chao');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.firebaseUid).toBe(uniqueKey);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.status).toBe('active');
      expect(res.body.session.userAgent).toBe('Vitest-E2E-Agent/1.0');

      activeSessionId = res.body.session.id;
      activeUserId = res.body.user.id;
    });

    it('E-03: Thất bại 401 khi thiếu trường idToken', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ userAgent: 'Chrome' })
        .expect(401);

      expect(res.body.message).toContain('Token khong hop le');
    });

    it('E-04: Thất bại 401 khi idToken là chuỗi rác không hợp lệ', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ idToken: 'invalid_garbage_token' })
        .expect(401);

      expect(res.body.message).toContain('Token khong hop le');
    });

    it('E-05: Tái sử dụng session khi người dùng đăng nhập lại bằng cùng một token', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({
          idToken: demoToken,
          userAgent: 'Updated-Agent/2.0',
        })
        .expect(200);

      expect(res.body.session.id).toBe(activeSessionId);
      expect(res.body.session.userAgent).toBe('Updated-Agent/2.0');
    });
  });

  // ─── 3. THÔNG TIN NGƯỜI DÙNG HIỆN TẠI (GET /me) ──────────────────────────
  describe('E-08 -> E-11: GET /api/v1/auth/me', () => {
    it('E-08: Lấy thông tin thành công bằng header x-session-id', async () => {
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('x-session-id', activeSessionId)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.id).toBe(activeUserId);
      expect(res.body.session.id).toBe(activeSessionId);
    });

    it('E-09: Lấy thông tin thành công bằng Bearer Authorization header', async () => {
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${demoToken}`)
        .expect(200);

      expect(res.body.user.firebaseUid).toBe(uniqueKey);
    });

    it('E-10: Thất bại khi không truyền bất kỳ header xác thực nào', async () => {
      await request(server).get('/api/v1/auth/me').expect(401);
    });

    it('E-11: Thất bại khi truyền x-session-id không tồn tại', async () => {
      await request(server)
        .get('/api/v1/auth/me')
        .set('x-session-id', 'non-existent-session-id')
        .expect(401);
    });
  });

  // ─── 4. KIỂM TRA PHIÊN (GET /session/:id/verify) ──────────────────────────
  describe('E-12 -> E-14: GET /api/v1/auth/session/:id/verify', () => {
    it('E-12: Trả về { valid: true } cho phiên đang hoạt động', async () => {
      const res = await request(server)
        .get(`/api/v1/auth/session/${activeSessionId}/verify`)
        .expect(200);

      expect(res.body.valid).toBe(true);
    });

    it('E-13: Trả về { valid: false } cho sessionId không tồn tại', async () => {
      const res = await request(server)
        .get('/api/v1/auth/session/unknown-id/verify')
        .expect(200);

      expect(res.body.valid).toBe(false);
    });
  });

  // ─── 5. QUẢN LÝ USER CRUD ────────────────────────────────────────────────
  describe('E-15 -> E-20: User Management APIs', () => {
    it('E-15: GET /api/v1/users - Lấy danh sách users', async () => {
      const res = await request(server).get('/api/v1/users').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((u: any) => u.id === activeUserId)).toBe(true);
    });

    it('E-16: GET /api/v1/users/:id - Lấy chi tiết user theo ID', async () => {
      const res = await request(server)
        .get(`/api/v1/users/${activeUserId}`)
        .expect(200);

      expect(res.body.id).toBe(activeUserId);
      expect(res.body.firebaseUid).toBe(uniqueKey);
    });

    it('E-17: GET /api/v1/users/:id - Báo lỗi 404 khi ID không tồn tại', async () => {
      await request(server).get('/api/v1/users/non-existent-user-id').expect(404);
    });

    it('E-19: PATCH /api/v1/users/:id - Cập nhật thông tin user', async () => {
      const res = await request(server)
        .patch(`/api/v1/users/${activeUserId}`)
        .send({ username: 'Updated Tester Name' })
        .expect(200);

      expect(res.body.username).toBe('Updated Tester Name');
    });

    it('E-20: PATCH /api/v1/users/:id/language - Chuyển đổi ngôn ngữ hiển thị', async () => {
      const res = await request(server)
        .patch(`/api/v1/users/${activeUserId}/language`)
        .send({ lang: 'en' })
        .expect(200);

      expect(res.body.currentLanguage).toBe('en');
    });
  });

  // ─── 6. ĐĂNG XUẤT (LOGOUT) ────────────────────────────────────────────────
  describe('E-21 -> E-24: POST /api/v1/auth/logout/:sessionId', () => {
    it('E-21: Đăng xuất thành công, thu hồi phiên làm việc', async () => {
      const res = await request(server)
        .post(`/api/v1/auth/logout/${activeSessionId}`)
        .expect(200);

      expect(res.body.message).toContain('Da dang xuat thanh cong');
    });

    it('E-22: Sau khi logout, session verify phải trả về valid: false', async () => {
      const res = await request(server)
        .get(`/api/v1/auth/session/${activeSessionId}/verify`)
        .expect(200);

      expect(res.body.valid).toBe(false);
    });

    it('E-23: Sau khi logout, truy cập /api/v1/auth/me với sessionId đó phải bị từ chối 401', async () => {
      await request(server)
        .get('/api/v1/auth/me')
        .set('x-session-id', activeSessionId)
        .expect(401);
    });

    it('E-24: Đăng xuất thất bại khi sessionId không tồn tại', async () => {
      await request(server)
        .post('/api/v1/auth/logout/invalid-session-uuid')
        .expect(401);
    });
  });

  // ─── 7. XÓA USER (DELETE) ─────────────────────────────────────────────────
  describe('E-25: DELETE /api/v1/users/:id - Xóa người dùng', () => {
    it('phải xóa người dùng thành công trả về 204 No Content', async () => {
      await request(server)
        .delete(`/api/v1/users/${activeUserId}`)
        .expect(204);

      // Sau khi xóa, tìm kiếm theo ID trả về 404
      await request(server)
        .get(`/api/v1/users/${activeUserId}`)
        .expect(404);
    });
  });
});

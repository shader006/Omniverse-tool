import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../backend-nestjs/src/auth/auth.service.js';
import { UserSession, SessionStatus } from '../../backend-nestjs/src/auth/entities/user-session.entity.js';
import { User, AuthProvider } from '../../backend-nestjs/src/user/entities/user.entity.js';
import { Repository } from 'typeorm';
import { UserService } from '../../backend-nestjs/src/user/user.service.js';
import { JwtService } from '@nestjs/jwt';

describe('AuthService - Firebase & Session Unit Tests (U-01 -> U-18)', () => {
  let authService: AuthService;
  let sessionRepo: Partial<Record<keyof Repository<UserSession>, any>>;
  let userService: Partial<Record<keyof UserService, any>>;
  let jwtService: Partial<Record<keyof JwtService, any>>;

  const createDummyUser = (uid = 'uid-123', name = 'Demo User'): User => {
    const user = new User();
    user.id = 'usr-uuid-999';
    user.firebaseUid = uid;
    user.username = name;
    user.email = `${name.toLowerCase().replace(/\s+/g, '')}@oniverse.app`;
    user.authProvider = AuthProvider.DEMO;
    return user;
  };

  const createDummySession = (user: User, token = 'demo.uid-123.test'): UserSession => {
    const session = new UserSession();
    session.id = 'sess-uuid-777';
    session.userId = user.id;
    session.user = user;
    session.firebaseToken = token;
    session.status = SessionStatus.ACTIVE;
    session.expiresAt = new Date(Date.now() + 3600 * 1000);
    return session;
  };

  beforeEach(() => {
    sessionRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn((data) => Object.assign(new UserSession(), data)),
      save: vi.fn(async (entity) => entity),
    };

    userService = {
      findOrCreate: vi.fn(),
      findByFirebaseUid: vi.fn(),
      findById: vi.fn(),
      findByEmail: vi.fn(),
    };

    jwtService = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
    };

    authService = new AuthService(
      sessionRepo as unknown as Repository<UserSession>,
      userService as unknown as UserService,
      jwtService as unknown as JwtService,
    );
  });

  // ─── DECODE TOKEN ──────────────────────────────────────────────────────────
  describe('TC U-01 -> U-04: decodeFirebaseToken()', () => {
    it('TC U-01: Giải mã chính xác Demo token (demo.<uid>.<name>)', async () => {
      const token = 'demo.custom-uid-01.john';
      const decoded = await authService.decodeFirebaseToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.uid).toBe('custom-uid-01');
      expect(decoded?.email).toBe('john@demo.oniverse.app');
      expect(decoded?.provider).toBe('demo');
    });

    it('TC U-02: Trả về null khi token rỗng hoặc không truyền', async () => {
      expect(await authService.decodeFirebaseToken('')).toBeNull();
      expect(await authService.decodeFirebaseToken(undefined as any)).toBeNull();
    });

    it('TC U-03: Giải mã JWT base64 offline fallback payload (3 phần)', async () => {
      const payload = {
        sub: 'offline-uid-888',
        email: 'offline@oniverse.app',
        name: 'Offline Dev',
        firebase: { sign_in_provider: 'google.com' },
      };
      const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const fakeJwt = `header.${b64Payload}.signature`;

      const decoded = await authService.decodeFirebaseToken(fakeJwt);

      expect(decoded).toBeDefined();
      expect(decoded?.uid).toBe('offline-uid-888');
      expect(decoded?.email).toBe('offline@oniverse.app');
      expect(decoded?.provider).toBe('google');
    });

    it('TC U-04: Trả về null khi token là chuỗi rác không hợp lệ', async () => {
      const trashToken = 'not_a_valid_token_string';
      const decoded = await authService.decodeFirebaseToken(trashToken);
      expect(decoded).toBeNull();
    });
  });

  // ─── LOGIN FIREBASE ────────────────────────────────────────────────────────
  describe('TC U-05 -> U-08: login() với Firebase / Demo token', () => {
    it('TC U-05: Đăng nhập thành công tạo mới Session và User', async () => {
      const dummyUser = createDummyUser('demo-u1', 'Alice');
      userService.findOrCreate = vi.fn().mockResolvedValue(dummyUser);
      sessionRepo.findOne = vi.fn().mockResolvedValue(null);

      const res = await authService.login(
        { idToken: 'demo.demo-u1.alice', userAgent: 'Mozilla/5.0' },
        '127.0.0.1',
      );

      expect(userService.findOrCreate).toHaveBeenCalled();
      expect(sessionRepo.create).toHaveBeenCalled();
      expect(sessionRepo.save).toHaveBeenCalled();
      expect(res.user.id).toBe(dummyUser.id);
      expect(res.session.status).toBe(SessionStatus.ACTIVE);
      expect(res.message).toContain('Xin chao, Alice!');
    });

    it('TC U-06: Đăng nhập thất bại ném UnauthorizedException khi token không hợp lệ', async () => {
      await expect(
        authService.login({ idToken: 'invalid-token' }, '127.0.0.1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('TC U-07: Tái sử dụng session cũ khi idToken đã có sẵn trong CSDL', async () => {
      const dummyUser = createDummyUser('demo-u1', 'Alice');
      const existingSession = createDummySession(dummyUser, 'demo.demo-u1.alice');
      userService.findOrCreate = vi.fn().mockResolvedValue(dummyUser);
      sessionRepo.findOne = vi.fn().mockResolvedValue(existingSession);

      const res = await authService.login(
        { idToken: 'demo.demo-u1.alice', userAgent: 'NewAgent/2.0' },
        '192.168.1.100',
      );

      expect(sessionRepo.create).not.toHaveBeenCalled();
      expect(existingSession.userAgent).toBe('NewAgent/2.0');
      expect(existingSession.ipAddress).toBe('192.168.1.100');
      expect(sessionRepo.save).toHaveBeenCalledWith(existingSession);
      expect(res.session).toBe(existingSession);
    });

    it('TC U-08: Ghi nhận chính xác IP và UserAgent vào Session entity', async () => {
      const dummyUser = createDummyUser();
      userService.findOrCreate = vi.fn().mockResolvedValue(dummyUser);
      sessionRepo.findOne = vi.fn().mockResolvedValue(null);

      const res = await authService.login(
        { idToken: 'demo.uid-ip.test', userAgent: 'Chrome/120' },
        '203.113.152.1',
      );

      expect(res.session.ipAddress).toBe('203.113.152.1');
      expect(res.session.userAgent).toBe('Chrome/120');
    });
  });

  // ─── GET ME ────────────────────────────────────────────────────────────────
  describe('TC U-09 -> U-12: getMe()', () => {
    it('TC U-09: Lấy thông tin thành công với Bearer token', async () => {
      const user = createDummyUser('bearer-uid', 'BearerUser');
      const session = createDummySession(user, 'demo.bearer-uid.bearer');
      userService.findByFirebaseUid = vi.fn().mockResolvedValue(user);
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      const res = await authService.getMe('Bearer demo.bearer-uid.bearer');

      expect(userService.findByFirebaseUid).toHaveBeenCalledWith('bearer-uid');
      expect(res.user.firebaseUid).toBe('bearer-uid');
      expect(res.session).toBe(session);
    });

    it('TC U-10: Lấy thông tin thành công qua sessionId', async () => {
      const user = createDummyUser();
      const session = createDummySession(user);
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      const res = await authService.getMe(undefined, 'sess-uuid-777');

      expect(res.user.id).toBe(user.id);
      expect(res.session?.id).toBe(session.id);
    });

    it('TC U-11: Ném UnauthorizedException khi sessionId đã bị revoke / hết hạn', async () => {
      const user = createDummyUser();
      const session = createDummySession(user);
      session.revoke(); // vô hiệu hóa
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      await expect(authService.getMe(undefined, 'sess-revoked')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('TC U-12: Ném UnauthorizedException khi không truyền bất kỳ thông tin xác thực nào', async () => {
      await expect(authService.getMe(undefined, undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── LOGOUT ────────────────────────────────────────────────────────────────
  describe('TC U-13 & U-14: logout()', () => {
    it('TC U-13: Đăng xuất thành công, chuyển status thành REVOKED và lưu CSDL', async () => {
      const user = createDummyUser();
      const session = createDummySession(user);
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      const res = await authService.logout('sess-uuid-777');

      expect(session.status).toBe(SessionStatus.REVOKED);
      expect(session.revokedAt).toBeDefined();
      expect(sessionRepo.save).toHaveBeenCalledWith(session);
      expect(res.message).toBe('Da dang xuat thanh cong.');
    });

    it('TC U-14: Ném UnauthorizedException khi sessionId không tồn tại trong CSDL', async () => {
      sessionRepo.findOne = vi.fn().mockResolvedValue(null);

      await expect(authService.logout('sess-non-existent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── VERIFY SESSION & GET SESSIONS ─────────────────────────────────────────
  describe('TC U-15 -> U-18: verifySession() & getSessionsByUser()', () => {
    it('TC U-15: verifySession() trả về valid: true cho session ACTIVE còn hạn', async () => {
      const user = createDummyUser();
      const session = createDummySession(user);
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      const res = await authService.verifySession('sess-valid');

      expect(res.valid).toBe(true);
    });

    it('TC U-16: verifySession() trả về valid: false cho session đã REVOKED', async () => {
      const user = createDummyUser();
      const session = createDummySession(user);
      session.revoke();
      sessionRepo.findOne = vi.fn().mockResolvedValue(session);

      const res = await authService.verifySession('sess-revoked');

      expect(res.valid).toBe(false);
    });

    it('TC U-17: verifySession() trả về valid: false cho session không tồn tại', async () => {
      sessionRepo.findOne = vi.fn().mockResolvedValue(null);

      const res = await authService.verifySession('sess-not-found');

      expect(res.valid).toBe(false);
    });

    it('TC U-18: getSessionsByUser() lấy danh sách phiên của một người dùng', async () => {
      const user = createDummyUser();
      const sessions = [createDummySession(user), createDummySession(user)];
      sessionRepo.find = vi.fn().mockResolvedValue(sessions);

      const res = await authService.getSessionsByUser(user.id);

      expect(sessionRepo.find).toHaveBeenCalledWith({ where: { userId: user.id } });
      expect(res).toHaveLength(2);
    });
  });
});

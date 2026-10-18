import { describe, it, expect, beforeEach } from 'vitest';
import { UserSession, SessionStatus } from '../../backend-nestjs/src/auth/entities/user-session.entity.js';

describe('UserSession Entity - Unit Tests (U-31 -> U-35)', () => {
  let session: UserSession;

  beforeEach(() => {
    session = new UserSession();
    session.id = 'sess-12345';
    session.userId = 'user-uuid-001';
    session.firebaseToken = 'demo.user001.test';
    session.status = SessionStatus.ACTIVE;
  });

  describe('TC U-31: Khởi tạo giá trị mặc định cho Session', () => {
    it('cần có trạng thái ACTIVE và các thông tin cơ bản', () => {
      expect(session.status).toBe(SessionStatus.ACTIVE);
      expect(session.userId).toBe('user-uuid-001');
      expect(session.firebaseToken).toBe('demo.user001.test');
      expect(session.revokedAt).toBeUndefined();
    });
  });

  describe('TC U-32: Phương thức isValid() - Phiên còn hiệu lực', () => {
    it('phải trả về true khi status là ACTIVE và chưa hết hạn', () => {
      // Hết hạn sau 1 giờ
      session.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      expect(session.isValid()).toBe(true);
    });

    it('phải trả về true khi status là ACTIVE và không có expiresAt (phiên vĩnh viễn)', () => {
      session.expiresAt = undefined as any;
      expect(session.isValid()).toBe(true);
    });
  });

  describe('TC U-33: Phương thức isValid() - Phiên đã hết hạn', () => {
    it('phải trả về false khi thời gian hiện tại đã vượt qua expiresAt', () => {
      // Đã hết hạn cách đây 5 phút
      session.expiresAt = new Date(Date.now() - 5 * 60 * 1000);
      expect(session.isValid()).toBe(false);
    });
  });

  describe('TC U-34: Phương thức revoke() - Thu hồi phiên (Logout)', () => {
    it('phải cập nhật trạng thái thành REVOKED, lưu thời điểm revokedAt và vô hiệu hóa session', () => {
      const beforeTime = new Date(Date.now() - 100);
      session.revoke();
      const afterTime = new Date(Date.now() + 100);

      expect(session.status).toBe(SessionStatus.REVOKED);
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(session.revokedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(session.revokedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());

      // Sau khi revoke thì isValid() phải là false
      expect(session.isValid()).toBe(false);
    });
  });

  describe('TC U-35: Phương thức expire() - Đánh dấu hết hạn tự động', () => {
    it('phải chuyển trạng thái thành EXPIRED và isValid() trả về false', () => {
      session.expire();

      expect(session.status).toBe(SessionStatus.EXPIRED);
      expect(session.isValid()).toBe(false);
    });
  });
});

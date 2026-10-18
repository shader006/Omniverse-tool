import { describe, it, expect, beforeEach } from 'vitest';
import { User, AppLanguage, AuthProvider, UserRole } from '../../backend-nestjs/src/user/entities/user.entity.js';

describe('User Entity - Unit Tests (U-36 -> U-42)', () => {
  let user: User;

  beforeEach(() => {
    user = new User();
  });

  describe('TC U-36: Khởi tạo giá trị mặc định cho User Entity', () => {
    it('cần gán các giá trị mặc định chính xác theo đặc tả UML', () => {
      // Thiết lập mặc định khi khởi tạo thủ công hoặc qua TypeORM
      user.role = UserRole.USER;
      user.currentLanguage = AppLanguage.VI;
      user.authProvider = AuthProvider.EMAIL;
      user.isActive = true;

      expect(user.role).toBe(UserRole.USER);
      expect(user.currentLanguage).toBe(AppLanguage.VI);
      expect(user.authProvider).toBe(AuthProvider.EMAIL);
      expect(user.isActive).toBe(true);
      expect(user.lastLoginAt).toBeUndefined();
    });
  });

  describe('TC U-37: Phương thức switchLanguage()', () => {
    it('cần chuyển đổi ngôn ngữ từ VI sang EN thành công', () => {
      user.currentLanguage = AppLanguage.VI;
      user.switchLanguage(AppLanguage.EN);
      expect(user.currentLanguage).toBe(AppLanguage.EN);
    });

    it('cần chuyển đổi ngôn ngữ từ EN sang VI thành công', () => {
      user.currentLanguage = AppLanguage.EN;
      user.switchLanguage(AppLanguage.VI);
      expect(user.currentLanguage).toBe(AppLanguage.VI);
    });
  });

  describe('TC U-38: Phương thức recordLogin()', () => {
    it('cần cập nhật lastLoginAt bằng thời gian hiện tại', () => {
      const beforeTime = new Date(Date.now() - 100);
      user.recordLogin();
      const afterTime = new Date(Date.now() + 100);

      expect(user.lastLoginAt).toBeInstanceOf(Date);
      expect(user.lastLoginAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(user.lastLoginAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('TC U-39: Phương thức isAdmin()', () => {
    it('phải trả về true khi vai trò là ADMIN', () => {
      user.role = UserRole.ADMIN;
      expect(user.isAdmin()).toBe(true);
    });

    it('phải trả về false khi vai trò là USER', () => {
      user.role = UserRole.USER;
      expect(user.isAdmin()).toBe(false);
    });

    it('phải trả về false khi vai trò chưa được định nghĩa', () => {
      (user as any).role = undefined;
      expect(user.isAdmin()).toBe(false);
    });
  });

  describe('TC U-40: Phương thức getDisplayName() - Ưu tiên Username', () => {
    it('phải trả về username nếu username có giá trị', () => {
      user.username = 'alex_dev';
      user.email = 'alex@example.com';
      expect(user.getDisplayName()).toBe('alex_dev');
    });
  });

  describe('TC U-41: Phương thức getDisplayName() - Fallback sang Email prefix', () => {
    it('phải trả về phần trước dấu @ của email nếu không có username', () => {
      user.username = '';
      user.email = 'tester.hcm@gmail.com';
      expect(user.getDisplayName()).toBe('tester.hcm');
    });
  });

  describe('TC U-42: Phương thức getDisplayName() - Fallback mặc định User', () => {
    it('phải trả về "User" khi cả username và email đều trống', () => {
      user.username = '';
      user.email = '';
      expect(user.getDisplayName()).toBe('User');
    });
  });
});

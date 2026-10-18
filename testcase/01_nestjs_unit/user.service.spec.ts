import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UserService } from '../../backend-nestjs/src/user/user.service.js';
import { User, AppLanguage, AuthProvider, UserRole } from '../../backend-nestjs/src/user/entities/user.entity.js';
import { Repository } from 'typeorm';

describe('UserService - Unit Tests (U-19 -> U-30)', () => {
  let service: UserService;
  let repo: Partial<Record<keyof Repository<User>, any>>;

  const mockUser = (override: Partial<User> = {}): User => {
    const u = new User();
    u.id = 'uuid-001';
    u.firebaseUid = 'fb-uid-001';
    u.email = 'tester@oniverse.app';
    u.username = 'tester';
    u.photoUrl = 'https://example.com/avatar.png';
    u.authProvider = AuthProvider.DEMO;
    u.currentLanguage = AppLanguage.VI;
    u.role = UserRole.USER;
    u.isActive = true;
    return Object.assign(u, override);
  };

  beforeEach(() => {
    repo = {
      create: vi.fn((dto) => Object.assign(new User(), dto)),
      save: vi.fn(async (entity) => entity),
      findOne: vi.fn(),
      find: vi.fn(),
      remove: vi.fn(async (entity) => entity),
    };

    service = new UserService(repo as unknown as Repository<User>);
  });

  describe('TC U-19: create() - Tạo người dùng mới', () => {
    it('cần tạo và lưu thành công người dùng mới vào CSDL', async () => {
      const dto = {
        firebaseUid: 'fb-new-001',
        email: 'newuser@oniverse.app',
        username: 'New User',
      };

      const result = await service.create(dto as any);

      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(repo.save).toHaveBeenCalled();
      expect(result.firebaseUid).toBe('fb-new-001');
    });
  });

  describe('TC U-20: findOrCreate() - Người dùng chưa tồn tại', () => {
    it('phải tạo user mới và ghi nhận recordLogin khi chưa có trong CSDL', async () => {
      repo.findOne = vi.fn().mockResolvedValue(null);

      const dto = {
        firebaseUid: 'fb-first-time',
        email: 'first@oniverse.app',
        username: 'First User',
      };

      const result = await service.findOrCreate(dto as any);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { firebaseUid: 'fb-first-time' } });
      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(result.lastLoginAt).toBeDefined();
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('TC U-21: findOrCreate() - Người dùng đã tồn tại (Upsert)', () => {
    it('phải cập nhật thông tin mới nhất và ghi nhận recordLogin', async () => {
      const existing = mockUser({ username: 'Old Name', photoUrl: 'old.png' });
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const dto = {
        firebaseUid: existing.firebaseUid,
        username: 'Updated Name',
        photoUrl: 'https://new.png',
      };

      const result = await service.findOrCreate(dto as any);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { firebaseUid: existing.firebaseUid } });
      expect(repo.create).not.toHaveBeenCalled();
      expect(result.username).toBe('Updated Name');
      expect(result.photoUrl).toBe('https://new.png');
      expect(result.lastLoginAt).toBeDefined();
      expect(repo.save).toHaveBeenCalledWith(existing);
    });
  });

  describe('TC U-22: findAll() - Lấy danh sách người dùng đang hoạt động', () => {
    it('phải gọi find với điều kiện isActive: true', async () => {
      const users = [mockUser(), mockUser({ id: 'uuid-002' })];
      repo.find = vi.fn().mockResolvedValue(users);

      const result = await service.findAll();

      expect(repo.find).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result).toHaveLength(2);
    });
  });

  describe('TC U-23: findById() - Tìm thấy người dùng theo UUID', () => {
    it('phải trả về đúng user khi id tồn tại', async () => {
      const existing = mockUser();
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const result = await service.findById('uuid-001');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'uuid-001' } });
      expect(result.id).toBe('uuid-001');
    });
  });

  describe('TC U-24: findById() - Không tìm thấy người dùng', () => {
    it('phải ném ra NotFoundException khi id không tồn tại', async () => {
      repo.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('TC U-25 & U-26: findByFirebaseUid()', () => {
    it('TC U-25: phải trả về User khi firebaseUid tồn tại', async () => {
      const existing = mockUser({ firebaseUid: 'fb-target' });
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const result = await service.findByFirebaseUid('fb-target');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { firebaseUid: 'fb-target' } });
      expect(result?.firebaseUid).toBe('fb-target');
    });

    it('TC U-26: phải trả về null khi firebaseUid không tồn tại', async () => {
      repo.findOne = vi.fn().mockResolvedValue(null);

      const result = await service.findByFirebaseUid('fb-unknown');

      expect(result).toBeNull();
    });
  });

  describe('TC U-27: update() - Cập nhật thông tin người dùng', () => {
    it('phải cập nhật trường dữ liệu tương ứng và lưu lại', async () => {
      const existing = mockUser();
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const result = await service.update('uuid-001', { username: 'New Name' });

      expect(result.username).toBe('New Name');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('TC U-28: switchLanguage() - Chuyển đổi ngôn ngữ', () => {
    it('phải cập nhật trường currentLanguage và lưu lại', async () => {
      const existing = mockUser({ currentLanguage: AppLanguage.VI });
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const result = await service.switchLanguage('uuid-001', AppLanguage.EN);

      expect(result.currentLanguage).toBe(AppLanguage.EN);
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('TC U-29: deactivate() - Vô hiệu hóa tài khoản (Soft Delete)', () => {
    it('phải gán isActive = false và không xóa dữ liệu vật lý', async () => {
      const existing = mockUser({ isActive: true });
      repo.findOne = vi.fn().mockResolvedValue(existing);

      const result = await service.deactivate('uuid-001');

      expect(result.isActive).toBe(false);
      expect(repo.save).toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe('TC U-30: remove() - Xóa tài khoản vĩnh viễn (Hard Delete)', () => {
    it('phải gọi repository.remove với đối tượng tìm thấy', async () => {
      const existing = mockUser();
      repo.findOne = vi.fn().mockResolvedValue(existing);

      await service.remove('uuid-001');

      expect(repo.remove).toHaveBeenCalledWith(existing);
    });
  });
});

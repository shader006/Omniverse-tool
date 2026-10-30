import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import { UserService } from './user.service.js';
import { User, AppLanguage, AuthProvider } from './entities/user.entity.js';

describe('UserService', () => {
  let service: UserService;
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    mockRepo = {
      create: vi.fn((dto) => {
        const u = new User();
        Object.assign(u, dto);
        return u;
      }),
      save: vi.fn(async (u) => ({ id: 'uuid-1', ...u })),
      findOne: vi.fn(),
      find: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('findOrCreate should create a new user if not existing and record login', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    const result = await service.findOrCreate({
      firebaseUid: 'uid-new',
      email: 'new@example.com',
      username: 'New User',
      authProvider: AuthProvider.DEMO,
    });

    expect(mockRepo.create).toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalled();
    expect(result.firebaseUid).toBe('uid-new');
    expect(result.lastLoginAt).toBeInstanceOf(Date);
  });

  it('findById should throw NotFoundException when user does not exist', async () => {
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('switchLanguage should update user language preference', async () => {
    const existing = new User();
    existing.id = 'uuid-1';
    existing.currentLanguage = AppLanguage.VI;
    mockRepo.findOne.mockResolvedValueOnce(existing);

    const updated = await service.switchLanguage('uuid-1', AppLanguage.EN);
    expect(updated.currentLanguage).toBe(AppLanguage.EN);
    expect(mockRepo.save).toHaveBeenCalledWith(existing);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { UserSession, SessionStatus } from './entities/user-session.entity.js';
import { UserService } from '../user/user.service.js';
import { User } from '../user/entities/user.entity.js';

describe('AuthService', () => {
  let service: AuthService;
  let mockSessionRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockUserService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    mockSessionRepo = {
      findOne: vi.fn(),
      create: vi.fn((dto) => {
        const s = new UserSession();
        Object.assign(s, dto);
        s.id = 'session-1';
        return s;
      }),
      save: vi.fn(async (s) => s),
      find: vi.fn(async () => []),
    };

    mockUserService = {
      findOrCreate: vi.fn(async (dto) => {
        const u = new User();
        u.id = 'user-1';
        u.firebaseUid = dto.firebaseUid;
        u.email = dto.email;
        u.username = dto.username;
        return u;
      }),
      findById: vi.fn(),
      findByFirebaseUid: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(UserSession),
          useValue: mockSessionRepo,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('decodeFirebaseToken parses demo token properly', async () => {
    const decoded = await service.decodeFirebaseToken('demo.uid100.alice');
    expect(decoded).not.toBeNull();
    expect(decoded?.uid).toBe('uid100');
    expect(decoded?.email).toBe('alice@demo.oniverse.app');
    expect(decoded?.provider).toBe('demo');
  });

  it('login throws UnauthorizedException on invalid token', async () => {
    await expect(
      service.login({ idToken: 'bad-token' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('login creates session and returns welcome message on valid demo token', async () => {
    mockSessionRepo.findOne.mockResolvedValueOnce(null);
    const res = await service.login(
      { idToken: 'demo.uid200.bob', userAgent: 'Vitest' },
      '127.0.0.1',
    );
    expect(res.user.firebaseUid).toBe('uid200');
    expect(res.session.status).toBe(SessionStatus.ACTIVE);
    expect(res.message).toContain('Dang nhap thanh cong');
  });
});


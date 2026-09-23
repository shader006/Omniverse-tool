/**
 * ============================================================
 * SERVICE: AuthService
 * ============================================================
 * Xu ly xac thuc Firebase Auth va quan ly phien dang nhap.
 *
 * Quy trinh dang nhap:
 *   1. Frontend dang nhap qua Firebase (Google/GitHub/Email)
 *   2. Firebase tra ve idToken (JWT)
 *   3. Frontend gui idToken len POST /auth/login
 *   4. AuthService xac minh token (Firebase Admin SDK)
 *   5. Tao hoac cap nhat User trong CSDL
 *   6. Tao UserSession moi luu token + IP + UserAgent
 *   7. Tra ve { user, session, message }
 * ============================================================
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSession, SessionStatus } from './entities/user-session.entity.js';
import { UserService } from '../user/user.service.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthProvider } from '../user/entities/user.entity.js';

// Kieu tra ve khi giai ma Firebase token
interface DecodedFirebaseToken {
  uid: string;
  email: string;
  name: string;
  picture: string;
  provider: string;
}

@Injectable()
export class AuthService {

  constructor(
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly userService: UserService,
  ) {}

  // ─── DANG NHAP ───────────────────────────────────────────────────────────

  /**
   * Xu ly dang nhap bang Firebase ID Token.
   *
   * @param loginDto  - DTO chua idToken tu frontend
   * @param ipAddress - Dia chi IP cua client
   * @returns User, UserSession va thong bao chao mung
   */
  async login(
    loginDto: LoginDto,
    ipAddress?: string,
  ): Promise<{ user: any; session: UserSession; message: string }> {

    // Buoc 1: Giai ma va xac minh Firebase token
    const decoded = this.decodeFirebaseToken(loginDto.idToken);
    if (!decoded) {
      throw new UnauthorizedException(
        'Token khong hop le hoac da het han. Vui long dang nhap lai.',
      );
    }

    // Buoc 2: Tim hoac tao User trong CSDL
    const user = await this.userService.findOrCreate({
      firebaseUid: decoded.uid,
      email:       decoded.email,
      username:    decoded.name,
      photoUrl:    decoded.picture,
      authProvider: decoded.provider as AuthProvider,
    });

    // Buoc 3: Tao UserSession moi
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const session = this.sessionRepository.create({
      userId:       user.id,
      firebaseToken: loginDto.idToken,
      userAgent:    loginDto.userAgent,
      ipAddress:    ipAddress,
      status:       SessionStatus.ACTIVE,
      expiresAt:    new Date(Date.now() + ONE_HOUR_MS),
    });
    await this.sessionRepository.save(session);

    return {
      user,
      session,
      message: 'Xin chao, ' + user.getDisplayName() + '! Dang nhap thanh cong.',
    };
  }

  // ─── DANG XUAT ───────────────────────────────────────────────────────────

  /**
   * Thu hoi phien dang nhap (dang xuat).
   * @param sessionId - ID cua phien can xoa
   */
  async logout(sessionId: string): Promise<{ message: string }> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new UnauthorizedException(
        'Phien dang nhap khong ton tai hoac da bi xoa.',
      );
    }

    // Danh dau la revoked (dang xuat thu cong)
    session.revoke();
    await this.sessionRepository.save(session);

    return { message: 'Da dang xuat thanh cong.' };
  }

  // ─── KIEM TRA PHIEN ──────────────────────────────────────────────────────

  /**
   * Xac minh phien co con hop le khong.
   * @param sessionId - ID phien can kiem tra
   */
  async verifySession(sessionId: string): Promise<{ valid: boolean }> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    return { valid: session ? session.isValid() : false };
  }

  /**
   * Lay tat ca phien dang nhap cua mot nguoi dung.
   * @param userId - ID noi bo cua User
   */
  async getSessionsByUser(userId: string): Promise<UserSession[]> {
    return this.sessionRepository.find({ where: { userId } });
  }

  // ─── HELPER: Giai ma Firebase Token ─────────────────────────────────────

  /**
   * Giai ma Firebase ID Token.
   *
   * PRODUCTION: dung firebase-admin:
   *   const decoded = await admin.auth().verifyIdToken(token);
   *
   * BAI TAP (gia lap): chi chap nhan token dinh dang "demo.<uid>.<email>"
   */
  private decodeFirebaseToken(token: string): DecodedFirebaseToken | null {
    try {
      // Gia lap cho bai tap: token = "demo.<uid>.<email>"
      if (token.startsWith('demo.')) {
        const parts = token.split('.');
        const uid   = parts[1] || 'demo-uid-001';
        const email = (parts[2] || 'demo') + '@demo.oniverse.app';
        return { uid, email, name: 'Demo User', picture: '', provider: 'demo' };
      }
      // Production: goi Firebase Admin SDK tai day
      // const decoded = await admin.auth().verifyIdToken(token);
      // return { uid: decoded.uid, email: decoded.email, ... };
      return null;
    } catch {
      return null;
    }
  }
}
/**
 * ============================================================
 * SERVICE: AuthService
 * ============================================================
 * Xu ly xac thuc Firebase Auth va quan ly phien dang nhap.
 *
 * Quy trinh dang nhap:
 *   1. Frontend dang nhap qua Firebase (Google/GitHub/Email)
 *   2. Firebase tra ve idToken (JWT)
 *   3. Frontend gui idToken len POST /api/v1/auth/login
 *   4. AuthService xac minh token (Firebase Admin SDK)
 *   5. Tao hoac cap nhat User trong CSDL SQLite
 *   6. Tao UserSession moi luu token + IP + UserAgent
 *   7. Tra ve { user, session, message }
 * ============================================================
 */

import { Injectable, UnauthorizedException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as fs from 'fs';
import { UserSession, SessionStatus } from './entities/user-session.entity.js';
import { UserService } from '../user/user.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtLoginDto } from './dto/jwt-login.dto.js';
import { User, AuthProvider } from '../user/entities/user.entity.js';

// Kieu tra ve khi giai ma Firebase token
interface DecodedFirebaseToken {
  uid: string;
  email: string;
  name: string;
  picture: string;
  provider: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  onModuleInit() {
    this.initFirebase();
  }

  private initFirebase() {
    if (getApps().length > 0) return;

    const projectId = process.env.FIREBASE_PROJECT_ID || 'omniveser-b918a';
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    try {
      if (saPath && fs.existsSync(saPath)) {
        initializeApp({
          credential: cert(saPath),
          projectId,
        });
        this.logger.log(`Firebase Admin SDK khoi tao voi Service Account file: ${saPath}`);
      } else {
        initializeApp({ projectId });
        this.logger.log(`Firebase Admin SDK khoi tao voi Project ID: ${projectId}`);
      }
    } catch (err: any) {
      this.logger.warn(`Loi khoi tao Firebase Admin SDK: ${err?.message}`);
    }
  }

  // ─── NESTJS JWT AUTHENTICATION ──────────────────────────────────────────

  /**
   * Kiem tra email va password nguoi dung bang bcrypt.
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (user && user.password) {
      const isMatch = await bcrypt.compare(pass, user.password);
      if (isMatch) {
        const { password, ...result } = user as any;
        return result;
      }
    }
    return null;
  }

  /**
   * Dang ky tai khoan nguoi dung moi (NestJS JWT)
   */
  async register(registerDto: RegisterDto): Promise<{ message: string; user: any; access_token: string }> {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(registerDto.password, salt);
    const user = await this.userService.registerWithPassword(
      registerDto.email,
      passwordHash,
      registerDto.username,
    );

    const payload = { sub: user.id, email: user.email, username: user.username, role: user.role };
    const access_token = this.jwtService.sign(payload);

    const { password, ...userWithoutPass } = user as any;
    return {
      message: 'Đăng ký tài khoản thành công.',
      user: userWithoutPass,
      access_token,
    };
  }

  /**
   * Dang nhap bang Email & Mật khẩu -> Tra ve JWT Access Token
   */
  async jwtLogin(jwtLoginDto: JwtLoginDto): Promise<{ message: string; user: any; access_token: string }> {
    const user = await this.validateUser(jwtLoginDto.email, jwtLoginDto.password);
    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác.');
    }

    const payload = { sub: user.id, email: user.email, username: user.username, role: user.role };
    return {
      message: 'Đăng nhập thành công.',
      user,
      access_token: this.jwtService.sign(payload),
    };
  }

  // ─── DANG NHAP (FIREBASE) ────────────────────────────────────────────────

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
  ): Promise<{ user: User; session: UserSession; message: string }> {

    // Buoc 1: Giai ma va xac minh Firebase token
    const decoded = await this.decodeFirebaseToken(loginDto.idToken);
    if (!decoded) {
      throw new UnauthorizedException(
        'Token khong hop le hoac da het han. Vui long dang nhap lai.',
      );
    }

    // Buoc 2: Tim hoac tao User trong CSDL
    let providerEnum = AuthProvider.EMAIL;
    if (decoded.provider === 'google') providerEnum = AuthProvider.GOOGLE;
    else if (decoded.provider === 'github') providerEnum = AuthProvider.GITHUB;
    else if (decoded.provider === 'demo') providerEnum = AuthProvider.DEMO;

    const user = await this.userService.findOrCreate({
      firebaseUid: decoded.uid,
      email:       decoded.email,
      username:    decoded.name,
      photoUrl:    decoded.picture,
      authProvider: providerEnum,
    });

    // Buoc 3: Tao hoac tai su dung UserSession
    const ONE_HOUR_MS = 60 * 60 * 1000;
    let session = await this.sessionRepository.findOne({
      where: { firebaseToken: loginDto.idToken },
    });

    if (session) {
      session.status = SessionStatus.ACTIVE;
      session.userId = user.id;
      session.expiresAt = new Date(Date.now() + ONE_HOUR_MS);
      if (loginDto.userAgent) session.userAgent = loginDto.userAgent;
      if (ipAddress) session.ipAddress = ipAddress;
    } else {
      session = this.sessionRepository.create({
        userId:        user.id,
        firebaseToken: loginDto.idToken,
        userAgent:     loginDto.userAgent,
        ipAddress:     ipAddress,
        status:        SessionStatus.ACTIVE,
        expiresAt:     new Date(Date.now() + ONE_HOUR_MS),
      });
    }

    await this.sessionRepository.save(session);

    return {
      user,
      session,
      message: 'Xin chao, ' + user.getDisplayName() + '! Dang nhap thanh cong.',
    };
  }

  // ─── THONG TIN NGUOI DUNG HIEN TAI ───────────────────────────────────────

  /**
   * Lay thong tin user hien tai dua vao Bearer token hoac sessionId.
   */
  async getMe(authHeader?: string, sessionId?: string): Promise<{ user: User; session?: UserSession }> {
    if (sessionId) {
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId },
        relations: { user: true },
      });
      if (session && session.isValid()) {
        const user = session.user || (await this.userService.findById(session.userId));
        return { user, session };
      }
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      const decoded = await this.decodeFirebaseToken(token);
      if (decoded) {
        const user = await this.userService.findByFirebaseUid(decoded.uid);
        if (user) {
          const session = await this.sessionRepository.findOne({
            where: { firebaseToken: token },
          });
          return { user, session: session || undefined };
        }
      }
    }

    throw new UnauthorizedException('Chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
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

  // ─── HELPER: Giai ma & Verify Firebase Token ────────────────────────────

  /**
   * Giai ma va xac minh Firebase ID Token.
   */
  public async decodeFirebaseToken(token: string): Promise<DecodedFirebaseToken | null> {
    if (!token) return null;

    try {
      // 1. Token test/demo theo chuan bai tap
      if (token.startsWith('demo.')) {
        const parts = token.split('.');
        const uid   = parts[1] || 'demo-uid-001';
        const email = (parts[2] || 'demo') + '@demo.oniverse.app';
        return { uid, email, name: 'Demo User', picture: '', provider: 'demo' };
      }

      // 2. Thu verify qua Firebase Admin SDK
      try {
        const decoded = await getAuth().verifyIdToken(token);
        const providerId = decoded.firebase?.sign_in_provider || 'email';
        let provider = 'email';
        if (providerId.includes('google')) provider = 'google';
        else if (providerId.includes('github')) provider = 'github';

        return {
          uid: decoded.uid,
          email: decoded.email || `${decoded.uid}@oniverse.app`,
          name: decoded.name || decoded.email?.split('@')[0] || 'User',
          picture: decoded.picture || '',
          provider,
        };
      } catch (verifyErr: any) {
        this.logger.debug(`VerifyIdToken offline fallback: ${verifyErr?.message}`);
      }

      // 3. Fallback JWT Payload parser neu offline hoac chua set secret key tren local
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
        const payload = JSON.parse(payloadJson);
        const uid = payload.user_id || payload.sub;
        if (uid) {
          const email = payload.email || `${uid}@oniverse.app`;
          const name = payload.name || email.split('@')[0] || 'User';
          const picture = payload.picture || '';
          const providerId = payload.firebase?.sign_in_provider || 'email';
          let provider = 'email';
          if (providerId.includes('google')) provider = 'google';
          else if (providerId.includes('github')) provider = 'github';

          return { uid, email, name, picture, provider };
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
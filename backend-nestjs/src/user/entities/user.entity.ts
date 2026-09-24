/**
 * ============================================================
 * ENTITY: User (Nguoi Dung)
 * ============================================================
 * Anh xa tu UML Class Diagram trong README.md:
 *
 *   class User {
 *     -String userId          --> firebaseUid (Firebase UID)
 *     -String username        --> username
 *     -String sessionToken    --> quan ly boi UserSession entity
 *     -String currentLanguage --> currentLanguage
 *     +createJob(...)         --> xu ly o MediaJobService
 *     +getJobStatus(jobId)    --> xu ly o MediaJobService
 *     +downloadResult(jobId)  --> xu ly o MediaJobService
 *     +switchLanguage(lang)   --> switchLanguage() method o day
 *   }
 *
 * Quan he:
 *   User (1) ---- (*) UserSession   [Aggregation: 1 user - nhieu phien]
 * ============================================================
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Length,
} from 'class-validator';

// ─── Enum: Ngon ngu giao dien ─────────────────────────────────────────────────
export enum AppLanguage {
  VI = 'vi',   // Tieng Viet
  EN = 'en',   // English
}

// ─── Enum: Nha cung cap xac thuc Firebase ────────────────────────────────────
export enum AuthProvider {
  EMAIL  = 'email',    // Email + Password
  GOOGLE = 'google',   // Google OAuth2
  GITHUB = 'github',   // GitHub OAuth2
  DEMO   = 'demo',     // Demo khong can dang nhap that
}

// ─── Enum: Vai tro nguoi dung ─────────────────────────────────────────────────
export enum UserRole {
  USER  = 'user',    // Nguoi dung thuong
  ADMIN = 'admin',   // Quan tri vien
}

// ─────────────────────────────────────────────────────────────────────────────

@Entity({ name: 'users' })
export class User {

  // ── Khoa chinh tu dong (UUID v4) ─────────────────────────────────────────
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Firebase UID: tương ứng -String userId trong UML ─────────────────────
  @Column({ unique: true, nullable: false, name: 'firebase_uid' })
  @IsNotEmpty()
  firebaseUid: string;

  // ── Ten tai khoan: tuong ung -String username trong UML ───────────────────
  @Column({ nullable: true, name: 'username', length: 100 })
  @IsOptional()
  @Length(2, 100)
  username: string;

  // ── Email dang nhap ───────────────────────────────────────────────────────
  @Column({ unique: true, nullable: true, name: 'email', length: 255 })
  @IsOptional()
  @IsEmail()
  email: string;

  // ── URL anh dai dien (tu Google/GitHub) ──────────────────────────────────
  @Column({ nullable: true, name: 'photo_url', length: 500 })
  @IsOptional()
  photoUrl: string;

  // ── Nha cung cap xac thuc: google | github | email | demo ────────────────
  @Column({ type: 'text', default: AuthProvider.EMAIL, name: 'auth_provider' })
  @IsEnum(AuthProvider)
  authProvider: AuthProvider;

  // ── Ngon ngu giao dien: tuong ung -String currentLanguage trong UML ───────
  @Column({ type: 'text', default: AppLanguage.VI, name: 'current_language' })
  @IsEnum(AppLanguage)
  currentLanguage: AppLanguage;

  // ── Vai tro nguoi dung ────────────────────────────────────────────────────
  @Column({ type: 'text', default: UserRole.USER, name: 'role' })
  @IsEnum(UserRole)
  role: UserRole;

  // ── Kich hoat tai khoan (soft-disable thay vi xoa) ────────────────────────
  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  // ── Thoi diem dang nhap gan nhat ─────────────────────────────────────────
  @Column({ nullable: true, type: 'datetime', name: 'last_login_at' })
  lastLoginAt: Date;

  // ── Timestamps tu dong ───────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // =========================================================================
  // METHODS - Anh xa tu UML Class Diagram
  // =========================================================================

  /**
   * +switchLanguage(lang): void  (UML)
   * Thay doi ngon ngu hien thi giao dien.
   */
  switchLanguage(lang: AppLanguage): void {
    this.currentLanguage = lang;
  }

  /**
   * Ghi lai thoi diem dang nhap (goi sau moi lan dang nhap thanh cong).
   */
  recordLogin(): void {
    this.lastLoginAt = new Date();
  }

  /**
   * Kiem tra nguoi dung co quyen admin khong.
   */
  isAdmin(): boolean {
    return this.role === UserRole.ADMIN;
  }

  /**
   * Tra ve ten hien thi uu tien: username > email prefix > 'User'.
   */
  getDisplayName(): string {
    if (this.username) return this.username;
    if (this.email) return this.email.split('@')[0];
    return 'User';
  }
}
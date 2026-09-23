/**
 * ============================================================
 * ENTITY: UserSession (Phien Dang Nhap)
 * ============================================================
 * Luu tru token va trang thai phien cua moi lan dang nhap.
 * Tuong ung -String sessionToken trong UML class User.
 *
 * Quan he:
 *   User (1) ---- (*) UserSession   [Aggregation]
 *   Mot User co nhieu phien; phien bi xoa khi User bi xoa.
 * ============================================================
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity.js';

// ─── Enum: Trang thai phien dang nhap ────────────────────────────────────────
export enum SessionStatus {
  ACTIVE  = 'active',    // Phien dang hoat dong
  EXPIRED = 'expired',   // Phien het han tu dong
  REVOKED = 'revoked',   // Phien bi thu hoi (dang xuat thu cong)
}

// ─────────────────────────────────────────────────────────────────────────────

@Entity({ name: 'user_sessions' })
export class UserSession {

  // ── Khoa chinh tu dong (UUID v4) ─────────────────────────────────────────
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Khoa ngoai lien ket voi User (cascade: xoa user -> xoa het session) ──
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', nullable: false })
  userId: string;

  // ── Firebase ID Token (JWT): tuong ung -String sessionToken trong UML ─────
  @Index()
  @Column({ unique: true, nullable: false, name: 'firebase_token', length: 2048 })
  firebaseToken: string;

  // ── Thiet bi / trinh duyet da dung dang nhap ─────────────────────────────
  @Column({ nullable: true, name: 'user_agent', length: 512 })
  userAgent: string;

  // ── Dia chi IP nguoi dung ─────────────────────────────────────────────────
  @Column({ nullable: true, name: 'ip_address', length: 45 })
  ipAddress: string;

  // ── Trang thai phien: active | expired | revoked ──────────────────────────
  @Column({ type: 'text', default: SessionStatus.ACTIVE, name: 'status' })
  status: SessionStatus;

  // ── Thoi gian het han cua token ───────────────────────────────────────────
  @Column({ nullable: true, type: 'datetime', name: 'expires_at' })
  expiresAt: Date;

  // ── Thoi diem dang xuat (khi revoke) ─────────────────────────────────────
  @Column({ nullable: true, type: 'datetime', name: 'revoked_at' })
  revokedAt: Date;

  // ── Timestamp tao phien ──────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // =========================================================================
  // METHODS
  // =========================================================================

  /**
   * Kiem tra phien co con hop le khong.
   * Het han neu: status != ACTIVE hoac qua thoi gian expiresAt.
   */
  isValid(): boolean {
    if (this.status !== SessionStatus.ACTIVE) return false;
    if (this.expiresAt && new Date() > this.expiresAt) return false;
    return true;
  }

  /**
   * Thu hoi phien - dang xuat thu cong.
   * Dat status = REVOKED va ghi lai thoi diem.
   */
  revoke(): void {
    this.status = SessionStatus.REVOKED;
    this.revokedAt = new Date();
  }

  /**
   * Danh dau phien het han tu dong.
   */
  expire(): void {
    this.status = SessionStatus.EXPIRED;
  }
}
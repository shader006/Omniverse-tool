import { IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO dang nhap - frontend gui Firebase ID Token sau khi xac thuc.
 *
 * Quy trinh dang nhap:
 *   1. Frontend: nguoi dung click "Dang nhap Google / GitHub"
 *   2. Firebase Auth xu ly OAuth, tra ve ID Token (JWT)
 *   3. Frontend gui idToken nay len POST /api/v1/auth/login
 *   4. Backend xac minh token, tao/cap nhat User + UserSession
 *   5. Backend tra ve thong tin User va sessionId
 */
export class LoginDto {
  /** Firebase ID Token (JWT) do Firebase Auth cap sau khi dang nhap */
  @IsNotEmpty()
  idToken: string;

  /** User Agent cua trinh duyet (de luu vao session) */
  @IsOptional()
  userAgent?: string;
}
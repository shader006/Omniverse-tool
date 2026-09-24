import { IsNotEmpty, IsOptional, IsEmail, IsEnum } from 'class-validator';
import { AppLanguage, AuthProvider } from '../entities/user.entity.js';

/**
 * DTO tao nguoi dung moi sau khi xac thuc Firebase token thanh cong.
 * Du lieu nay lay tu Firebase decoded token.
 */
export class CreateUserDto {
  /** Firebase UID do Firebase Auth cap */
  @IsNotEmpty()
  firebaseUid: string;

  /** Ten hien thi cua nguoi dung */
  @IsOptional()
  username?: string;

  /** Dia chi email */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** URL anh dai dien tu Google / GitHub */
  @IsOptional()
  photoUrl?: string;

  /** Nha cung cap xac thuc: google | github | email | demo */
  @IsOptional()
  @IsEnum(AuthProvider)
  authProvider?: AuthProvider;

  /** Ngon ngu giao dien mac dinh */
  @IsOptional()
  @IsEnum(AppLanguage)
  currentLanguage?: AppLanguage;
}
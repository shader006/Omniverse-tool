import { IsOptional, IsEnum, Length } from 'class-validator';
import { AppLanguage } from '../entities/user.entity.js';

/**
 * DTO cap nhat thong tin nguoi dung.
 * Nguoi dung chi co the thay doi: ten hien thi, anh, ngon ngu.
 */
export class UpdateUserDto {
  /** Cap nhat ten hien thi */
  @IsOptional()
  @Length(2, 100)
  username?: string;

  /** Cap nhat URL anh dai dien */
  @IsOptional()
  photoUrl?: string;

  /**
   * Doi ngon ngu giao dien.
   * Tuong ung phuong thuc +switchLanguage(lang): void trong UML.
   */
  @IsOptional()
  @IsEnum(AppLanguage)
  currentLanguage?: AppLanguage;
}
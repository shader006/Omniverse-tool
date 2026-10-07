/**
 * ============================================================
 * SERVICE: UserService
 * ============================================================
 * Xu ly nghiep vu CRUD cho entity User.
 *
 * Anh xa phuong thuc UML class User:
 *   +switchLanguage(lang): void  --> switchLanguage()
 *   +getJobStatus(jobId)         --> phan chuyen sang MediaJobService
 *   +createJob(...)              --> phan chuyen sang MediaJobService
 * ============================================================
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, AppLanguage } from './entities/user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UserService {

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────

  /** Tao moi mot nguoi dung */
  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(createUserDto);
    return this.userRepository.save(user);
  }

  /** Đăng ký người dùng mới với mật khẩu đã băm (NestJS JWT Auth) */
  async registerWithPassword(email: string, passwordHash: string, username?: string): Promise<User> {
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new BadRequestException('Email này đã được sử dụng. Vui lòng chọn email khác.');
    }

    const user = this.userRepository.create({
      email,
      password: passwordHash,
      username: username || email.split('@')[0],
      firebaseUid: 'jwt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    });

    return this.userRepository.save(user);
  }

  /**
   * Tim nguoi dung theo firebaseUid; neu chua co thi tao moi.
   * Goi moi lan dang nhap (upsert pattern).
   */
  async findOrCreate(createUserDto: CreateUserDto): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { firebaseUid: createUserDto.firebaseUid },
    });

    if (!user) {
      // Lan dau dang nhap: tao tai khoan moi
      user = this.userRepository.create(createUserDto);
    } else {
      // Da co tai khoan: cap nhat ten / anh neu Firebase tra ve moi hon
      if (createUserDto.username) user.username = createUserDto.username;
      if (createUserDto.photoUrl) user.photoUrl = createUserDto.photoUrl;
    }

    // Ghi lai thoi diem dang nhap (recordLogin trong UML)
    user.recordLogin();
    return this.userRepository.save(user);
  }

  // ─── READ ────────────────────────────────────────────────────────────────

  /** Lay danh sach tat ca nguoi dung */
  async findAll(): Promise<User[]> {
    return this.userRepository.find({ where: { isActive: true } });
  }

  /** Tim nguoi dung theo ID noi bo (UUID) */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Khong tim thay nguoi dung voi ID: ' + id);
    }
    return user;
  }

  /** Tim nguoi dung theo Firebase UID */
  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { firebaseUid } });
  }

  /** Tim nguoi dung theo email (kèm mật khẩu) */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  /** Cap nhat thong tin nguoi dung */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  /**
   * Doi ngon ngu giao dien.
   * Tuong ung phuong thuc +switchLanguage(lang): void trong UML.
   */
  async switchLanguage(id: string, lang: AppLanguage): Promise<User> {
    const user = await this.findById(id);
    user.switchLanguage(lang);
    return this.userRepository.save(user);
  }

  // ─── DELETE ──────────────────────────────────────────────────────────────

  /** Vo hieu hoa tai khoan (soft delete - giu du lieu) */
  async deactivate(id: string): Promise<User> {
    const user = await this.findById(id);
    user.isActive = false;
    return this.userRepository.save(user);
  }

  /** Xoa hoan toan nguoi dung khoi CSDL (hard delete) */
  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.userRepository.remove(user);
  }
}
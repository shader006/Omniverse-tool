/**
 * ============================================================
 * CONTROLLER: UserController
 * ============================================================
 * REST API endpoints quan ly nguoi dung.
 *
 * Base URL: /api/v1/users
 * ============================================================
 */

import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { AppLanguage } from './entities/user.entity.js';

@Controller('users')
export class UserController {

  constructor(private readonly userService: UserService) {}

  /** GET /users - Lay danh sach tat ca nguoi dung */
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  /** GET /users/:id - Lay thong tin chi tiet mot nguoi dung */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  /** PATCH /users/:id - Cap nhat ten, anh dai dien */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  /**
   * PATCH /users/:id/language
   * Doi ngon ngu giao dien.
   * Anh xa phuong thuc +switchLanguage(lang): void trong UML.
   *
   * Body: { "lang": "vi" } hoac { "lang": "en" }
   */
  @Patch(':id/language')
  switchLanguage(
    @Param('id') id: string,
    @Body('lang') lang: AppLanguage,
  ) {
    return this.userService.switchLanguage(id, lang);
  }

  /** DELETE /users/:id - Xoa nguoi dung khoi CSDL */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
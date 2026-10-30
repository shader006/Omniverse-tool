import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   * Dang nhap bang Firebase ID Token tu frontend.
   * Frontend gui token nay sau khi Google/GitHub/Firebase OAuth thanh cong.
   * Server tu dong set HttpOnly Cookie sessionId va khoi tao Session.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip: string = req.ip || req.socket?.remoteAddress || 'unknown';
    const result = await this.authService.login(loginDto, ip);

    // Ghi sessionId vao HttpOnly Cookie de trinh duyet tu dong gui o moi request
    res.cookie('sessionId', result.session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngay
      path: '/',
    });

    // Dong bo vao Express Session (neu co)
    if (req.session) {
      (req.session as any).userId = result.user.id;
      (req.session as any).sessionId = result.session.id;
    }

    return result;
  }

  /**
   * GET /auth/me
   * Lay thong tin nguoi dung va phien hien tai tu Cookie, Session, Header hoac Bearer Token.
   */
  @Get('me')
  getMe(@Req() req: Request) {
    const authHeader = req.headers['authorization'];
    const sessionId =
      req.cookies?.sessionId ||
      (req.session as any)?.sessionId ||
      req.headers['x-session-id'];
    return this.authService.getMe(authHeader, sessionId as string);
  }

  /**
   * POST /auth/logout
   * Dang xuat - xoa cookie, huy session va thu hoi phien trong CSDL.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logoutCurrent(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId =
      req.cookies?.sessionId ||
      (req.session as any)?.sessionId ||
      (req.headers['x-session-id'] as string);

    if (sessionId) {
      await this.authService.logout(sessionId);
    }

    // Xoa Cookie tren trinh duyet
    res.clearCookie('sessionId', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    // Huy Express Session neu co
    if (req.session) {
      req.session.destroy(() => {});
    }

    return { message: 'Đã đăng xuất thành công.' };
  }

  /**
   * POST /auth/logout/:sessionId
   * Dang xuat thu cong theo sessionId cu the.
   */
  @Post('logout/:sessionId')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(sessionId);

    // Neu dang xuat dung session hien tai thi xoa cookie luon
    if (req.cookies?.sessionId === sessionId) {
      res.clearCookie('sessionId', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
      if (req.session) {
        req.session.destroy(() => {});
      }
    }

    return result;
  }

  /**
   * GET /auth/session/:sessionId/verify
   * Kiem tra phien co con hop le khong.
   */
  @Get('session/:sessionId/verify')
  verifySession(@Param('sessionId') sessionId: string) {
    return this.authService.verifySession(sessionId);
  }

  /**
   * GET /auth/sessions/user/:userId
   * Lay tat ca phien dang nhap cua mot nguoi dung.
   */
  @Get('sessions/user/:userId')
  getSessionsByUser(@Param('userId') userId: string) {
    return this.authService.getSessionsByUser(userId);
  }
}
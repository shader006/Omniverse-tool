import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {

  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login
   * Dang nhap bang Firebase ID Token tu frontend.
   * Frontend gui token nay sau khi Google/GitHub OAuth thanh cong.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto, @Req() req: any) {
    const ip: string = req.ip || req.socket?.remoteAddress || 'unknown';
    return this.authService.login(loginDto, ip);
  }

  /**
   * GET /auth/me
   * Lay thong tin nguoi dung va phien hien tai tu Token hoac SessionId.
   */
  @Get('me')
  getMe(@Req() req: any) {
    const authHeader = req.headers['authorization'];
    const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
    return this.authService.getMe(authHeader, sessionId);
  }

  /**
   * POST /auth/logout/:sessionId
   * Dang xuat - thu hoi phien dang nhap hien tai.
   */
  @Post('logout/:sessionId')
  @HttpCode(HttpStatus.OK)
  logout(@Param('sessionId') sessionId: string) {
    return this.authService.logout(sessionId);
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
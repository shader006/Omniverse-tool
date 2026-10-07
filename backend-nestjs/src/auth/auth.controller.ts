import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtLoginDto } from './dto/jwt-login.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Controller('auth')
export class AuthController {

  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/register
   * Đăng ký tài khoản mới bằng Email & Mật khẩu (Chuẩn NestJS JWT)
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * POST /api/v1/auth/login-jwt
   * Đăng nhập bằng Email & Mật khẩu -> Trả về JWT Access Token
   */
  @Post('login-jwt')
  @HttpCode(HttpStatus.OK)
  loginJwt(@Body() jwtLoginDto: JwtLoginDto) {
    return this.authService.jwtLogin(jwtLoginDto);
  }

  /**
   * POST /api/v1/auth/login
   * Hỗ trợ linh hoạt:
   * 1. Nếu gửi { email, password } -> Thực hiện đăng nhập NestJS JWT
   * 2. Nếu gửi { idToken } -> Thực hiện đăng nhập Firebase
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: any, @Req() req: any) {
    if (body.email && body.password) {
      return this.authService.jwtLogin(body as JwtLoginDto);
    }
    const ip: string = req.ip || req.socket?.remoteAddress || 'unknown';
    return this.authService.login(body as LoginDto, ip);
  }

  /**
   * GET /api/v1/auth/profile
   * API được bảo vệ bằng JwtAuthGuard (Yêu cầu Header Authorization: Bearer <token>)
   * Chuẩn theo tài liệu NestJS: https://docs.nestjs.com/security/authentication#jwt-functionality
   */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: any) {
    return {
      message: 'Xác thực JWT thành công! Truy cập tài nguyên bảo mật hợp lệ.',
      user: req.user,
    };
  }

  /**
   * GET /api/v1/auth/me
   * Lấy thông tin người dùng hiện tại từ Bearer Token hoặc Session ID.
   */
  @Get('me')
  getMe(@Req() req: any) {
    const authHeader = req.headers['authorization'];
    const sessionId = req.headers['x-session-id'] || req.cookies?.sessionId;
    return this.authService.getMe(authHeader, sessionId);
  }

  /**
   * POST /api/v1/auth/logout/:sessionId
   * Đăng xuất - thu hồi phiên làm việc.
   */
  @Post('logout/:sessionId')
  @HttpCode(HttpStatus.OK)
  logout(@Param('sessionId') sessionId: string) {
    return this.authService.logout(sessionId);
  }

  /**
   * GET /api/v1/auth/session/:sessionId/verify
   * Kiểm tra phiên có còn hợp lệ không.
   */
  @Get('session/:sessionId/verify')
  verifySession(@Param('sessionId') sessionId: string) {
    return this.authService.verifySession(sessionId);
  }
}
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const sessionId = request.headers['x-session-id'] || request.cookies?.sessionId;

    if (!authHeader && !sessionId) {
      throw new UnauthorizedException('Yêu cầu đăng nhập để truy cập tài nguyên này.');
    }

    try {
      const { user, session } = await this.authService.getMe(authHeader, sessionId);
      request.user = user;
      request.session = session;
      return true;
    } catch (err: any) {
      throw new UnauthorizedException(err.message || 'Xác thực không thành công.');
    }
  }
}

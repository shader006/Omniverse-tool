import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserSession } from './entities/user-session.entity.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { jwtConstants } from './constants.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSession]),
    UserModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, JwtStrategy],
  exports: [AuthService, AuthGuard, JwtModule, PassportModule],
})
export class AuthModule {}
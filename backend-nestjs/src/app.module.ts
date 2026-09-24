import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { UserModule } from './user/user.module.js';
import { AuthModule } from './auth/auth.module.js';
import { User } from './user/entities/user.entity.js';
import { UserSession } from './auth/entities/user-session.entity.js';

@Module({
  imports: [
    // Ket noi CSDL dung better-sqlite3 (khong can cai dat rieng server)
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DATABASE_PATH || 'oniverse.db',
      entities: [User, UserSession],
      synchronize: true,
      logging: false,
    }),
    UserModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
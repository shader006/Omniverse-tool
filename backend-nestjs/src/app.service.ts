import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo(): object {
    return {
      project:  'Oniverse - Multi Media & AI Tools',
      version:  '1.0.0',
      team:     'Nhom 1 - Tong Nguyen Bao Long (23010111) + Tran Bui Nguyen Duong (23010570)',
      modules:  ['UserModule (dang nhap)', 'AuthModule (phien dang nhap)'],
      entities: ['User', 'UserSession'],
    };
  }
}
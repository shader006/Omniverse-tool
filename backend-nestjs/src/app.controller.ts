import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** GET / - Thong tin du an */
  @Get()
  getInfo() {
    return this.appService.getInfo();
  }
}
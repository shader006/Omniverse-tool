import { Module } from '@nestjs/common';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [JobsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { TaskModule } from './modules/task/task.module';
import { MediaModule } from './modules/media/media.module';
import { AiModule } from './modules/ai/ai.module';
import { ConvertModule } from './modules/convert/convert.module';

@Module({
  imports: [TaskModule, MediaModule, AiModule, ConvertModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}

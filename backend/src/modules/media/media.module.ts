import { Module } from '@nestjs/common';
import { AdminModule } from '../../common/admin.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ImageEnhanceProcessor } from './image-enhance.processor';

@Module({
  imports: [AdminModule],
  controllers: [MediaController],
  providers: [MediaService, ImageEnhanceProcessor],
  exports: [MediaService],
})
export class MediaModule {}

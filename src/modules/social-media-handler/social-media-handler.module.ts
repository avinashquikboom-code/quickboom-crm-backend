import { Module } from '@nestjs/common';
import { SocialMediaHandlerService } from './social-media-handler.service';
import { SocialMediaHandlerController } from './social-media-handler.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SocialMediaHandlerController],
  providers: [SocialMediaHandlerService],
  exports: [SocialMediaHandlerService],
})
export class SocialMediaHandlerModule {}

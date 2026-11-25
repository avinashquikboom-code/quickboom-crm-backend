import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicWebsiteController } from './public-website.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PublicWebsiteController],
})
export class PublicWebsiteModule {}

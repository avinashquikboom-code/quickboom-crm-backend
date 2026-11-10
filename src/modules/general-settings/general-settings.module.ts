import { Module } from '@nestjs/common';
import { GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService } from './general-settings.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [GeneralSettingsController],
  providers: [GeneralSettingsService],
  exports: [GeneralSettingsService],
})
export class GeneralSettingsModule {}


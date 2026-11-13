import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GoogleMapsUsageService } from './google-maps-usage.service';
import { GoogleMapsUsageController } from './google-maps-usage.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [GoogleMapsUsageController],
  providers: [GoogleMapsUsageService],
  exports: [GoogleMapsUsageService],
})
export class GoogleMapsUsageModule {}

import { Module } from '@nestjs/common';
import { RemoteWorkService } from './remote-work.service';
import { RemoteWorkController } from './remote-work.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [RemoteWorkController],
  providers: [RemoteWorkService],
  exports: [RemoteWorkService],
})
export class RemoteWorkModule {}

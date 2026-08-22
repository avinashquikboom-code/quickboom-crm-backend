import { Module } from '@nestjs/common';
import { RemoteWorkService } from './remote-work.service';
import { RemoteWorkController } from './remote-work.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RemoteWorkController],
  providers: [RemoteWorkService],
  exports: [RemoteWorkService],
})
export class RemoteWorkModule {}

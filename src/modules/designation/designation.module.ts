import { Module, forwardRef } from '@nestjs/common';
import { DesignationService } from './designation.service';
import { DesignationController } from './designation.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [PrismaModule, forwardRef(() => WorkModule)],
  controllers: [DesignationController],
  providers: [DesignationService],
  exports: [DesignationService],
})
export class DesignationModule {}

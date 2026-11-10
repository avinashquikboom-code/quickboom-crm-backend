import { Module } from '@nestjs/common';
import { DataManagementController } from './data-management.controller';
import { DataManagementService } from './data-management.service';
import { DataGovernanceService } from './data-governance.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DataManagementController],
  providers: [DataManagementService, DataGovernanceService],
  exports: [DataManagementService],
})
export class DataManagementModule {}

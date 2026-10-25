import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { MobileTaskController } from './mobile-task.controller';
import { NotificationModule } from '../notification/notification.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [NotificationModule, WorkModule],
  controllers: [TaskController, MobileTaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}

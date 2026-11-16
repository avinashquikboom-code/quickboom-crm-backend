import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LateMarkReportService } from './late-mark-report.service';

@Injectable()
export class LateMarkReportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LateMarkReportScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reports: LateMarkReportService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.reports.runDue().catch((error: any) => {
        this.logger.error(`Late mark report scheduler failed: ${error?.message}`);
      });
    }, 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

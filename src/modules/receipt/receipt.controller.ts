import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReceiptService } from './receipt.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Response } from 'express';

@ApiTags('Receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomerGuard)
@Controller('receipts')
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Get(':receiptId')
  @ApiOperation({ summary: 'Get payment receipt details' })
  async getReceipt(
    @Param('receiptId') receiptId: string,
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const numCustomerId = customerId ? parseInt(customerId, 10) : req?.customerId || user?.customerId;
    return this.receiptService.getReceipt(receiptId, numCustomerId, user);
  }

  @Get(':receiptId/download')
  @ApiOperation({ summary: 'Download payment receipt PDF' })
  async downloadReceipt(
    @Param('receiptId') receiptId: string,
    @CurrentCustomer() customerId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const numCustomerId = customerId ? parseInt(customerId, 10) : req?.customerId || user?.customerId;
    return this.receiptService.downloadReceiptPdf(receiptId, numCustomerId, user, res);
  }
}

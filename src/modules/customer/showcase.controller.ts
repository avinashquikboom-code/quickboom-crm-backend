import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ShowcaseService, ProductShowcaseResponse } from './showcase.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomerGuard } from '../../common/guards/customer.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';

@ApiTags('Product Showcase')
@Controller()
export class ShowcaseController {
  constructor(private readonly showcaseService: ShowcaseService) { }

  @Get(['customer/products/showcase', 'products/showcase', 'customer/showcase/pinteresty-tops'])
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, CustomerGuard)
  @ApiOperation({ summary: 'Get Businees Tools product showcase for Customer Home screen' })
  async getPinterestyTopsShowcase(
    @CurrentCustomer() customerId?: string,
  ): Promise<{ statusCode: number; success: boolean; data: ProductShowcaseResponse }> {
    const data = await this.showcaseService.getPinterestyTopsShowcase(customerId);
    return {
      statusCode: 200,
      success: true,
      data,
    };
  }
}

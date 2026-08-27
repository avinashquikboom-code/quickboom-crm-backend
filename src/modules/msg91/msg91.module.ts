import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Msg91Service } from './msg91.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [Msg91Service],
  exports: [Msg91Service],
})
export class Msg91Module {}

import { Module, Global } from '@nestjs/common';
import { Msg91Service } from './msg91.service';

@Global()
@Module({
  imports: [],
  providers: [Msg91Service],
  exports: [Msg91Service],
})
export class Msg91Module {}

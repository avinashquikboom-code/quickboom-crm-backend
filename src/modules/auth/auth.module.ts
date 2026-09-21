import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MobileAuthController } from './mobile-auth.controller';
import { AdminAuthController } from './admin-auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { QBIdGenerator } from './qb-id.generator';
import { NotificationModule } from '../notification/notification.module';
import { WorkModule } from '../work/work.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    NotificationModule,
    forwardRef(() => WorkModule),
  ],
  controllers: [AuthController, MobileAuthController, AdminAuthController],
  providers: [AuthService, JwtStrategy, QBIdGenerator],
  exports: [AuthService, JwtStrategy, QBIdGenerator, PassportModule],
})
export class AuthModule {}


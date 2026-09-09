import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function runTests() {
  console.log('=== STARTING 7 CUSTOMER LOGIN TEST CASES ===\n');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const authService = app.get(AuthService);
  const customerService = app.get(CustomerService);
  const prisma = app.get(PrismaService);

  let passedCount = 0;

  try {
    const testEmail = 'demo@gmail.com';
    const testPassword = 'validPassword123';

    let user = await prisma.user.findFirst({
      where: { email: { equals: testEmail, mode: 'insensitive' } },
      include: { customer: true },
    });

    if (!user) {
      throw new Error(`Test user ${testEmail} not found!`);
    }

    const customerId = user.customerId || user.customer!.id;

    // Ensure customer is ACTIVE and has valid active subscription initially
    await prisma.customer.update({
      where: { id: customerId },
      data: { isActive: true, deletedAt: null },
    });

    const passwordHash = await bcrypt.hash(testPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, isActive: true, deletedAt: null },
    });

    const now = new Date();
    const futureDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    let activeSub = await prisma.customerSubscription.findFirst({
      where: { customerId, status: SubscriptionStatus.ACTIVE, deletedAt: null },
    });
    if (!activeSub) {
      activeSub = await prisma.customerSubscription.create({
        data: {
          customerId,
          planId: 1,
          status: SubscriptionStatus.ACTIVE,
          startDate: now,
          endDate: futureDate,
        },
      });
    } else {
      await prisma.customerSubscription.update({
        where: { id: activeSub.id },
        data: { status: SubscriptionStatus.ACTIVE, endDate: futureDate },
      });
    }

    // -------------------------------------------------------------
    // CASE 1: Active workspace + valid credentials -> Login successful
    // -------------------------------------------------------------
    console.log('Test Case 1: Active workspace + valid credentials');
    try {
      const loginRes = await authService.login(testEmail, testPassword, 'CUSTOMER');
      if (loginRes && loginRes.tokens?.accessToken && loginRes.user?.id === user.id) {
        console.log('✅ Case 1 PASSED: Login successful, accessToken generated.\n');
        passedCount++;
      } else {
        console.error('❌ Case 1 FAILED: Unexpected response format', loginRes);
      }
    } catch (err) {
      console.error('❌ Case 1 FAILED with exception:', err);
    }

    // -------------------------------------------------------------
    // CASE 2: Suspended workspace + valid credentials -> Workspace suspended message
    // -------------------------------------------------------------
    console.log('Test Case 2: Suspended workspace + valid credentials');
    await prisma.customer.update({
      where: { id: customerId },
      data: { isActive: false },
    });
    try {
      await authService.login(testEmail, testPassword, 'CUSTOMER');
      console.error('❌ Case 2 FAILED: Login should have been blocked for suspended workspace!');
    } catch (err: any) {
      const resp = err.getResponse ? err.getResponse() : null;
      const code = typeof resp === 'object' ? resp.code : null;
      const message = typeof resp === 'object' ? resp.message : err.message;
      if (
        err instanceof UnauthorizedException &&
        code === 'WORKSPACE_SUSPENDED' &&
        message.includes('suspended')
      ) {
        console.log(`✅ Case 2 PASSED: Received 401 with code=${code}, message="${message}"\n`);
        passedCount++;
      } else {
        console.error('❌ Case 2 FAILED: Unexpected exception details:', resp || err);
      }
    } finally {
      // Re-activate workspace
      await prisma.customer.update({
        where: { id: customerId },
        data: { isActive: true },
      });
    }

    // -------------------------------------------------------------
    // CASE 3: Expired subscription -> Correct subscription error
    // -------------------------------------------------------------
    console.log('Test Case 3: Expired subscription');
    const pastDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await prisma.customerSubscription.updateMany({
      where: { customerId },
      data: { status: SubscriptionStatus.EXPIRED, endDate: pastDate },
    });
    try {
      await authService.login(testEmail, testPassword, 'CUSTOMER');
      console.error('❌ Case 3 FAILED: Login should have thrown SUBSCRIPTION_EXPIRED!');
    } catch (err: any) {
      const resp = err.getResponse ? err.getResponse() : null;
      const code = typeof resp === 'object' ? resp.code : null;
      const message = typeof resp === 'object' ? resp.message : err.message;
      if (
        err instanceof UnauthorizedException &&
        code === 'SUBSCRIPTION_EXPIRED' &&
        message.includes('expired')
      ) {
        console.log(`✅ Case 3 PASSED: Received 401 with code=${code}, message="${message}"\n`);
        passedCount++;
      } else {
        console.error('❌ Case 3 FAILED: Unexpected exception details:', resp || err);
      }
    } finally {
      // Restore subscription to ACTIVE
      await prisma.customerSubscription.update({
        where: { id: activeSub.id },
        data: { status: SubscriptionStatus.ACTIVE, endDate: futureDate },
      });
    }

    // -------------------------------------------------------------
    // CASE 4: Invalid password -> Invalid credentials
    // -------------------------------------------------------------
    console.log('Test Case 4: Invalid password');
    try {
      await authService.login(testEmail, 'WrongPassword999!', 'CUSTOMER');
      console.error('❌ Case 4 FAILED: Login should have rejected wrong password!');
    } catch (err: any) {
      const resp = err.getResponse ? err.getResponse() : null;
      const code = typeof resp === 'object' ? resp.code : null;
      const message = typeof resp === 'object' ? resp.message : err.message;
      if (
        err instanceof UnauthorizedException &&
        code === 'INVALID_CREDENTIALS' &&
        message.includes('Invalid credentials')
      ) {
        console.log(`✅ Case 4 PASSED: Received 401 with code=${code}, message="${message}"\n`);
        passedCount++;
      } else {
        console.error('❌ Case 4 FAILED: Unexpected exception details:', resp || err);
      }
    }

    // -------------------------------------------------------------
    // CASE 5: Non-existent customer -> Correct authentication error
    // -------------------------------------------------------------
    console.log('Test Case 5: Non-existent customer');
    try {
      await authService.login('nonexistent_user_9999@example.com', 'somePassword123', 'CUSTOMER');
      console.error('❌ Case 5 FAILED: Login should have rejected non-existent customer!');
    } catch (err: any) {
      const resp = err.getResponse ? err.getResponse() : null;
      const code = typeof resp === 'object' ? resp.code : null;
      const message = typeof resp === 'object' ? resp.message : err.message;
      if (
        err instanceof UnauthorizedException &&
        code === 'INVALID_CREDENTIALS' &&
        message.includes('Invalid credentials')
      ) {
        console.log(`✅ Case 5 PASSED: Received 401 with code=${code}, message="${message}"\n`);
        passedCount++;
      } else {
        console.error('❌ Case 5 FAILED: Unexpected exception details:', resp || err);
      }
    }

    // -------------------------------------------------------------
    // CASE 6: Admin changes workspace from ACTIVE -> SUSPENDED
    // -> Customer login immediately respects the new status
    // -------------------------------------------------------------
    console.log('Test Case 6: Admin changes workspace from ACTIVE -> SUSPENDED');
    await customerService.update(customerId, { isActive: false });
    try {
      await authService.login(testEmail, testPassword, 'CUSTOMER');
      console.error('❌ Case 6 FAILED: Login should have been blocked immediately after admin suspended!');
    } catch (err: any) {
      const resp = err.getResponse ? err.getResponse() : null;
      const code = typeof resp === 'object' ? resp.code : null;
      const message = typeof resp === 'object' ? resp.message : err.message;
      if (
        err instanceof UnauthorizedException &&
        code === 'WORKSPACE_SUSPENDED' &&
        message.includes('suspended')
      ) {
        console.log(`✅ Case 6 PASSED: Admin suspension immediately blocked customer login with WORKSPACE_SUSPENDED.\n`);
        passedCount++;
      } else {
        console.error('❌ Case 6 FAILED: Unexpected exception details:', resp || err);
      }
    }

    // -------------------------------------------------------------
    // CASE 7: Admin changes workspace from SUSPENDED -> ACTIVE
    // -> Customer can login again
    // -------------------------------------------------------------
    console.log('Test Case 7: Admin changes workspace from SUSPENDED -> ACTIVE');
    await customerService.update(customerId, { isActive: true });
    try {
      const loginRes = await authService.login(testEmail, testPassword, 'CUSTOMER');
      if (loginRes && loginRes.tokens?.accessToken) {
        console.log('✅ Case 7 PASSED: Customer can login successfully after admin re-activated workspace!\n');
        passedCount++;
      } else {
        console.error('❌ Case 7 FAILED: Login response invalid', loginRes);
      }
    } catch (err) {
      console.error('❌ Case 7 FAILED with exception:', err);
    }

    // Restore original password hash for demo@gmail.com ('123456')
    const originalHash = await bcrypt.hash('123456', 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: originalHash, isActive: true, deletedAt: null },
    });

    console.log(`==============================================`);
    console.log(`FINAL RESULT: ${passedCount} OF 7 TEST CASES PASSED`);
    console.log(`==============================================\n`);

  } finally {
    await app.close();
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});

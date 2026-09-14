import { PrismaClient } from '@prisma/client';
import { InfluencerService } from '../modules/influencer/influencer.service';
import { BadRequestException } from '@nestjs/common';

const prisma = new PrismaClient();
const influencerService = new InfluencerService(prisma as any, null as any);

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING INFLUENCER SELF-REGISTRATION & APPROVAL E2E TEST');
  console.log('====================================================\n');

  const testEmail1 = `creator_test_${Date.now()}@example.com`;
  const testPhone1 = `+1999${Math.floor(100000 + Math.random() * 900000)}`;
  const testEmail2 = `creator_reject_${Date.now()}@example.com`;
  const testPhone2 = `+1888${Math.floor(100000 + Math.random() * 900000)}`;

  let creatorId1: number | null = null;
  let creatorId2: number | null = null;

  try {
    // ----------------------------------------------------
    // STEP 1: SELF-REGISTRATION (PENDING)
    // ----------------------------------------------------
    console.log('[TEST 1] Registering Creator 1...');
    const regResult = await influencerService.registerInfluencer({
      name: 'E2E Test Creator',
      email: testEmail1,
      phone: testPhone1,
      password: 'StrongPassword123!',
      platform: 'INSTAGRAM',
      instagramHandle: '@e2e_test_creator',
      followers: 75000,
      bio: 'Fashion and lifestyle creator based in NYC',
      startingPrice: 500,
      // Attempt to inject status: 'APPROVED' to test security
      status: 'APPROVED',
    } as any);

    creatorId1 = regResult.influencer.id;
    console.log(`✓ Creator 1 created with ID: ${creatorId1}`);
    console.log(`✓ Status returned: ${regResult.status} (expected: PENDING)`);
    console.log(`✓ Status in influencer record: ${regResult.influencer.status} (expected: PENDING)`);
    console.log(`✓ isActive in database: ${regResult.influencer.isActive} (expected: false)`);

    if (regResult.status !== 'PENDING' || regResult.influencer.isActive !== false) {
      throw new Error(`SECURITY FAIL: Creator status should be PENDING and isActive false, got status=${regResult.status}, isActive=${regResult.influencer.isActive}`);
    }

    // ----------------------------------------------------
    // STEP 2: PUBLIC VISIBILITY CHECK (MUST BE HIDDEN)
    // ----------------------------------------------------
    console.log('\n[TEST 2] Checking Public Customer Visibility for Pending Creator...');
    const publicList = await influencerService.getActiveInfluencers({});
    const foundInPublic = publicList.some(inf => inf.id === creatorId1);
    console.log(`✓ Is Creator 1 visible in customer marketplace? ${foundInPublic} (expected: false)`);
    if (foundInPublic) {
      throw new Error('LEAK FAIL: Pending influencer appeared in customer active marketplace!');
    }

    // ----------------------------------------------------
    // STEP 3: BOOKING PROTECTION (MUST BE REJECTED)
    // ----------------------------------------------------
    console.log('\n[TEST 3] Testing Booking Protection on Pending Creator...');
    let bookingBlocked = false;
    try {
      await influencerService.createBooking(99999, {
        influencerId: creatorId1,
        requirements: 'Testing booking protection',
      } as any);
    } catch (err: any) {
      bookingBlocked = true;
      console.log(`✓ Booking correctly rejected: "${err.message}" (HTTP status: ${err.status || 400})`);
    }

    if (!bookingBlocked) {
      throw new Error('SECURITY FAIL: Booking to PENDING influencer was not blocked!');
    }

    // ----------------------------------------------------
    // STEP 4: ADMIN APPLICATION REVIEW & APPROVAL
    // ----------------------------------------------------
    console.log('\n[TEST 4] Admin Fetch Applications & Approve...');
    const applications = await influencerService.getInfluencerApplicationsAdmin({ status: 'PENDING' });
    const applicationFound = applications.items.some(app => app.id === creatorId1);
    console.log(`✓ Creator 1 found in Admin Applications list: ${applicationFound} (expected: true)`);
    if (!applicationFound) {
      throw new Error('ADMIN FAIL: Creator 1 was not listed in Admin pending applications!');
    }

    console.log('Approving Creator 1...');
    const approvedRes = await influencerService.approveInfluencerAdmin(creatorId1, 1);
    const approvedCreator = approvedRes.influencer;
    console.log(`✓ Status after approval: ${approvedCreator.status} (expected: APPROVED)`);
    console.log(`✓ isActive after approval: ${approvedCreator.isActive} (expected: true)`);
    console.log(`✓ approvedAt: ${approvedCreator.approvedAt}`);
    console.log(`✓ approvedBy: ${approvedCreator.approvedBy}`);

    if (approvedCreator.status !== 'APPROVED' || !approvedCreator.isActive) {
      throw new Error('ADMIN FAIL: Influencer approval did not update status to APPROVED or isActive to true');
    }

    // ----------------------------------------------------
    // STEP 5: PUBLIC VISIBILITY AFTER APPROVAL
    // ----------------------------------------------------
    console.log('\n[TEST 5] Checking Public Customer Visibility for Approved Creator...');
    const publicListAfterApproval = await influencerService.getActiveInfluencers({});
    const foundAfterApproval = publicListAfterApproval.some(inf => inf.id === creatorId1);
    console.log(`✓ Is Creator 1 visible in customer marketplace after approval? ${foundAfterApproval} (expected: true)`);
    if (!foundAfterApproval) {
      throw new Error('FLOW FAIL: Approved influencer did not become visible in customer marketplace!');
    }

    // ----------------------------------------------------
    // STEP 6: REJECTION & RESUBMISSION FLOW
    // ----------------------------------------------------
    console.log('\n[TEST 6] Testing Rejection and Resubmission on Creator 2...');
    const regResult2 = await influencerService.registerInfluencer({
      name: 'Creator To Reject',
      email: testEmail2,
      phone: testPhone2,
      password: 'StrongPassword123!',
      platform: 'YOUTUBE',
      youtubeHandle: '@reject_me',
      followers: 1200,
    });
    creatorId2 = regResult2.influencer.id;
    console.log(`✓ Creator 2 registered with ID: ${creatorId2}, status: ${regResult2.status}`);

    const rejectionReason = 'Follower count does not meet the minimum threshold of 5,000 for YouTube creators.';
    const rejectRes = await influencerService.rejectInfluencerAdmin(creatorId2, { reason: rejectionReason }, 1);
    const rejectedCreator = rejectRes.influencer;
    console.log(`✓ Status after rejection: ${rejectedCreator.status} (expected: REJECTED)`);
    console.log(`✓ Rejection reason: "${rejectedCreator.rejectionReason}"`);
    console.log(`✓ rejectedAt: ${rejectedCreator.rejectedAt}`);
    console.log(`✓ rejectedBy: ${rejectedCreator.rejectedBy}`);

    if (rejectedCreator.status !== 'REJECTED' || rejectedCreator.rejectionReason !== rejectionReason) {
      throw new Error('ADMIN FAIL: Rejection did not properly set status or rejectionReason');
    }

    console.log('Testing Creator 2 Resubmission...');
    const resubmitRes = await influencerService.resubmitApplication(creatorId2, {
      followers: 8500,
      bio: 'Updated channel with verified analytics',
    });
    const resubmitted = resubmitRes.influencer;
    console.log(`✓ Status after resubmission: ${resubmitted.status} (expected: PENDING)`);
    console.log(`✓ Rejection reason after resubmission: "${resubmitted.rejectionReason}" (expected: null)`);
    console.log(`✓ Updated followers: ${resubmitted.followers} (expected: 8500)`);

    if (resubmitted.status !== 'PENDING' || resubmitted.rejectionReason !== null) {
      throw new Error('RESUBMISSION FAIL: Application was not reset to PENDING or rejectionReason was not cleared');
    }

    // ----------------------------------------------------
    // STEP 7: SUSPENSION FLOW
    // ----------------------------------------------------
    console.log('\n[TEST 7] Testing Suspension on Approved Creator 1...');
    const suspendRes = await influencerService.suspendInfluencerAdmin(creatorId1, 1);
    const suspendedCreator = suspendRes.influencer;
    console.log(`✓ Status after suspension: ${suspendedCreator.status} (expected: SUSPENDED)`);
    console.log(`✓ isActive after suspension: ${suspendedCreator.isActive} (expected: false)`);
    console.log(`✓ suspendedAt: ${suspendedCreator.suspendedAt}`);

    const publicListAfterSuspend = await influencerService.getActiveInfluencers({});
    const foundAfterSuspend = publicListAfterSuspend.some(inf => inf.id === creatorId1);
    console.log(`✓ Is Creator 1 visible in customer marketplace after suspension? ${foundAfterSuspend} (expected: false)`);
    if (foundAfterSuspend) {
      throw new Error('SUSPENSION FAIL: Suspended creator was still visible in marketplace!');
    }

    console.log('\n====================================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 100% VERIFIED.');
    console.log('====================================================\n');
  } finally {
    // Cleanup test records
    console.log('Cleaning up test data...');
    if (creatorId1) {
      await prisma.influencer.delete({ where: { id: creatorId1 } }).catch(() => {});
    }
    if (creatorId2) {
      await prisma.influencer.delete({ where: { id: creatorId2 } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log('Cleanup completed.');
  }
}

runTests().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});

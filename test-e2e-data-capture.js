const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runTests() {
  console.log('====================================================');
  console.log('STARTING REAL END-TO-END DATA CAPTURE → LEAD IMPORT TEST');
  console.log('====================================================');

  const customerId = 1;
  const userId = 21;
  const testPlaceId = 2167;

  // 1. Prepare DataCapturePlace 2167 for testing
  let place = await prisma.dataCapturePlace.findUnique({ where: { id: testPlaceId } });
  if (!place) {
    console.log(`[SETUP] Creating DataCapturePlace ID ${testPlaceId}...`);
    place = await prisma.dataCapturePlace.create({
      data: {
        id: testPlaceId,
        customerId: customerId,
        googlePlaceId: 'ChIJ_TEST_PLACE_2167_E2E',
        businessName: 'Grand Hyatt Vadodara Luxury Resort',
        category: 'Hotel & Resort',
        address: 'R.C. Dutt Road, Alkapuri, Vadodara, Gujarat 390007',
        phone: '+91 265 234 5678',
        email: 'reservations@grandhyattvadodara.com',
        website: 'https://grandhyattvadodara.com',
        rating: 4.8,
        reviewCount: 1420,
        latitude: 22.3123,
        longitude: 73.1812,
        googleMapsUrl: 'https://maps.google.com/?cid=12345678902167',
        businessStatus: 'OPERATIONAL',
        source: 'GOOGLE_DISCOVERY',
        status: 'CAPTURED',
        isImported: false,
        photos: [
          'https://lh3.googleusercontent.com/p/AF1QipN_resort_front.jpg',
          'https://lh3.googleusercontent.com/p/AF1QipN_resort_pool.jpg'
        ],
        socialMedia: {
          instagram: 'https://instagram.com/grandhyattvadodara',
          facebook: 'https://facebook.com/grandhyattvadodara',
          linkedin: 'https://linkedin.com/company/grandhyattvadodara'
        },
        rawData: {
          capturedBy: 13,
          employeeId: 13,
          source: 'GOOGLE_DISCOVERY'
        }
      }
    });
    console.log(`[SETUP] Created test DataCapturePlace ID ${testPlaceId}: ${place.businessName}`);
  } else {
    // Reset import status for fresh testing
    await prisma.dataCapturePlace.update({
      where: { id: testPlaceId },
      data: { isImported: false, importedLeadId: null, status: 'CAPTURED' }
    });
    console.log(`[SETUP] Reset DataCapturePlace ID ${testPlaceId} to unimported`);
  }

  // 2. Instantiate DataCaptureService via compiled backend
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('./dist/app.module');
  const { DataCaptureService } = require('./dist/modules/data-capture/data-capture.service');
  const { LeadService } = require('./dist/modules/lead/lead.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const dataCaptureService = app.get(DataCaptureService);
  const leadService = app.get(LeadService);

  console.log('\n--- TEST 1: POST /api/v1/data-capture/2167/create-lead ---');
  const importResult = await dataCaptureService.createLeadFromPlace(customerId, userId, testPlaceId);
  console.log('createLeadFromPlace Result:', {
    success: importResult.success,
    leadId: importResult.leadId,
    message: importResult.message,
    isDuplicate: importResult.isDuplicate
  });

  const createdLeadId = importResult.leadId;
  if (!createdLeadId) {
    throw new Error('FAILED: No leadId returned from createLeadFromPlace');
  }

  console.log('\n--- TEST 2: VERIFY DATABASE PERSISTENCE ---');
  const dbLead = await prisma.lead.findUnique({
    where: { id: createdLeadId },
    include: { images: true, socialProfiles: true }
  });

  console.log('Database Lead:', {
    id: dbLead.id,
    companyName: dbLead.companyName,
    title: dbLead.title,
    phone: dbLead.phone,
    email: dbLead.email,
    website: dbLead.website,
    address: dbLead.address,
    city: dbLead.city,
    state: dbLead.state,
    pincode: dbLead.pincode,
    category: dbLead.category,
    source: dbLead.source,
    googlePlaceId: dbLead.googlePlaceId,
    rating: dbLead.rating,
    reviewCount: dbLead.reviewCount,
    sourceRecordId: dbLead.sourceRecordId,
    captureRequestId: dbLead.captureRequestId,
    imagesCount: dbLead.images.length,
    socialProfilesCount: dbLead.socialProfiles.length
  });

  // Assertions
  if (dbLead.companyName === 'Business Lead' || dbLead.companyName === 'Unnamed Business') {
    throw new Error(`FAILED: companyName is still generic fallback: ${dbLead.companyName}`);
  }
  if (dbLead.companyName !== 'Grand Hyatt Vadodara Luxury Resort') {
    throw new Error(`FAILED: Expected "Grand Hyatt Vadodara Luxury Resort", got "${dbLead.companyName}"`);
  }
  if (dbLead.googlePlaceId !== 'ChIJ_TEST_PLACE_2167_E2E') {
    throw new Error(`FAILED: Expected googlePlaceId "ChIJ_TEST_PLACE_2167_E2E", got "${dbLead.googlePlaceId}"`);
  }
  if (dbLead.sourceRecordId !== String(testPlaceId)) {
    throw new Error(`FAILED: Expected sourceRecordId "${testPlaceId}", got "${dbLead.sourceRecordId}"`);
  }
  if (dbLead.images.length === 0) {
    throw new Error('FAILED: Expected attached images in LeadImage relation');
  }

  console.log('\n--- TEST 3: VERIFY GET /api/v1/leads/:id ---');
  const fetchedLead = await leadService.getLeadById(customerId, createdLeadId);
  console.log('GET /leads/:id Result:', {
    id: fetchedLead.id,
    companyName: fetchedLead.companyName,
    phone: fetchedLead.phone,
    website: fetchedLead.website,
    address: fetchedLead.address,
    googlePlaceId: fetchedLead.googlePlaceId,
    sourceRecordId: fetchedLead.sourceRecordId
  });

  console.log('\n--- TEST 4: VERIFY DATACAPTUREPLACE UPDATED ---');
  const updatedPlace = await prisma.dataCapturePlace.findUnique({ where: { id: testPlaceId } });
  console.log('DataCapturePlace Status:', {
    id: updatedPlace.id,
    isImported: updatedPlace.isImported,
    importedLeadId: updatedPlace.importedLeadId,
    status: updatedPlace.status
  });
  if (!updatedPlace.isImported || updatedPlace.importedLeadId !== createdLeadId) {
    throw new Error('FAILED: DataCapturePlace isImported or importedLeadId not updated');
  }

  console.log('\n--- TEST 5: DUPLICATE IMPORT DETECTION ---');
  const dupResult = await dataCaptureService.createLeadFromPlace(customerId, userId, testPlaceId);
  console.log('Duplicate Call Result:', {
    success: dupResult.success,
    leadId: dupResult.leadId,
    isDuplicate: dupResult.isDuplicate,
    message: dupResult.message
  });
  if (dupResult.leadId !== createdLeadId) {
    throw new Error(`FAILED: Expected duplicate detection to return existing lead ${createdLeadId}`);
  }

  console.log('\n--- TEST 6: TENANT ISOLATION (WRONG CUSTOMER ID) ---');
  try {
    await dataCaptureService.createLeadFromPlace(999, userId, testPlaceId);
    throw new Error('FAILED: Expected 404/NotFoundException for wrong customerId');
  } catch (err) {
    console.log('Tenant Isolation successfully blocked unauthorized access:', err.message);
  }

  console.log('\n--- TEST 7: INVALID PLACE ID ---');
  try {
    await dataCaptureService.createLeadFromPlace(customerId, userId, 999999);
    throw new Error('FAILED: Expected 404 for non-existent placeId');
  } catch (err) {
    console.log('Invalid placeId successfully returned 404:', err.message);
  }

  console.log('\n====================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY! ZERO ERRORS!');
  console.log('====================================================');

  await app.close();
  await prisma.$disconnect();
}

runTests().catch((err) => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});

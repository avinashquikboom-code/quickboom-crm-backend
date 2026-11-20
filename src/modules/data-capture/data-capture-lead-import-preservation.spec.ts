import { DataCaptureService } from './data-capture.service';

describe('Data Capture to CRM Lead Import - Full Business Information Preservation', () => {
  let service: DataCaptureService;
  let prisma: any;
  let leads: any[];
  let captures: any[];
  let socialProfiles: any[];

  beforeEach(() => {
    leads = [];
    captures = [];
    socialProfiles = [];

    const matches = (row: any, where: any) =>
      Object.entries(where).every(([key, value]) => {
        if (key === 'deletedAt') return row.deletedAt === null || row.deletedAt === undefined;
        if (key === 'customerId' && typeof value === 'object' && (value as any)?.in) {
          return (value as any).in.includes(row.customerId);
        }
        if (key === 'OR' && Array.isArray(value)) {
          return value.some((clause) => matches(row, clause));
        }
        return row[key] === value;
      });

    prisma = {
      user: {
        findFirst: jest.fn(async ({ where }) => ({
          id: where?.id || 10,
          customerId: where?.customerId || 2,
          role: 'ADMIN',
        })),
      },
      employee: {
        findFirst: jest.fn(async () => ({ id: 5, userId: 10 })),
      },
      dataCaptureJob: {
        findFirst: jest.fn(async () => ({ jobId: 'job-places-1', customerId: 2, userId: 10 })),
      },
      dataCapturePlace: {
        findFirst: jest.fn(async ({ where }) => captures.find((row) => matches(row, where)) || null),
        findMany: jest.fn(async ({ where }) => captures.filter((row) => matches(row, where))),
        update: jest.fn(async ({ where, data }) => {
          const row = captures.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      lead: {
        findFirst: jest.fn(async ({ where }) => leads.find((row) => matches(row, where)) || null),
        findMany: jest.fn(async ({ where }) => {
          if (!where) return leads;
          return leads.filter((row) => {
            if (where.customerId && row.customerId !== where.customerId) return false;
            if (where.deletedAt === null && row.deletedAt != null) return false;
            if (where.OR && Array.isArray(where.OR)) {
              return where.OR.some(
                (clause: any) =>
                  (clause.googlePlaceId && clause.googlePlaceId === row.googlePlaceId) ||
                  (clause.sourceRecordId && clause.sourceRecordId === row.sourceRecordId) ||
                  (clause.phone && row.phone && clause.phone === row.phone) ||
                  (clause.email && row.email && clause.email.toLowerCase() === row.email.toLowerCase()),
              );
            }
            return true;
          });
        }),
        create: jest.fn(async ({ data }) => {
          const row = { id: leads.length + 101, ...data };
          leads.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }) => {
          const row = leads.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          let count = 0;
          for (const row of leads) {
            if (row.id === where.id && row.customerId === where.customerId && row.deletedAt === null) {
              if (where.OR && Array.isArray(where.OR)) {
                const matchesOr = where.OR.some((cond: any) => {
                  const field = Object.keys(cond)[0];
                  return row[field] == null || row[field] === '';
                });
                if (!matchesOr) continue;
              }
              Object.assign(row, data);
              count++;
            }
          }
          return { count };
        }),
      },
      leadSocialProfile: {
        findFirst: jest.fn(async ({ where }) =>
          socialProfiles.find((sp) => sp.leadId === where.leadId && sp.platform === where.platform) || null,
        ),
        create: jest.fn(async ({ data }) => {
          const row = { id: socialProfiles.length + 1, ...data };
          socialProfiles.push(row);
          return row;
        }),
      },
      leadStage: { findFirst: jest.fn().mockResolvedValue({ id: 20, key: 'NEW', name: 'New' }) },
      leadActivityTimeline: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    let queue = Promise.resolve();
    prisma.$transaction = jest.fn((callback) => {
      const result = queue.then(() => callback(prisma));
      queue = result.catch(() => undefined);
      return result;
    });

    service = new DataCaptureService({} as any, prisma, {} as any);
  });

  it('preserves all business, contact, location, rating, review, and social media data upon lead import', async () => {
    captures.push({
      id: 201,
      customerId: 2,
      googlePlaceId: 'ChIJ_GRAND_HYATT_VADODARA',
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
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
      notes: 'Luxury 5-star hotel in Alkapuri Vadodara',
      socialMedia: {
        facebook: 'https://facebook.com/grandhyattvadodara',
        instagram: 'https://instagram.com/grandhyattvadodara',
        linkedin: 'https://linkedin.com/company/grandhyattvadodara',
      },
      rawData: {
        city: 'Vadodara',
        state: 'Gujarat',
        country: 'India',
        pincode: '390007',
      },
    });

    const result = await service.importToLeads(
      2,
      { id: 10, customerId: 2, role: 'ADMIN' },
      { places: [{ id: 201 }] },
    );

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(leads).toHaveLength(1);

    const importedLead = leads[0];

    // Business Information
    expect(importedLead.companyName).toBe('Grand Hyatt Vadodara Luxury Resort');
    expect(importedLead.title).toBe('Grand Hyatt Vadodara Luxury Resort');
    expect(importedLead.category).toBe('Hotel & Resort');
    expect(importedLead.address).toBe('R.C. Dutt Road, Alkapuri, Vadodara, Gujarat 390007');
    expect(importedLead.city).toBe('Vadodara');
    expect(importedLead.state).toBe('Gujarat');
    expect(importedLead.country).toBe('India');
    expect(importedLead.pincode).toBe('390007');

    // Contact Information
    expect(importedLead.phone).toBe('+912652345678');
    expect(importedLead.email).toBe('reservations@grandhyattvadodara.com');
    expect(importedLead.website).toBe('https://grandhyattvadodara.com/');

    // Google Places Information
    expect(importedLead.googlePlaceId).toBe('ChIJ_GRAND_HYATT_VADODARA');
    expect(importedLead.rating).toBe(4.8);
    expect(importedLead.reviewCount).toBe(1420);
    expect(importedLead.latitude).toBe(22.3123);
    expect(importedLead.longitude).toBe(73.1812);

    // CRM Information
    expect(importedLead.customerId).toBe(2);
    expect(importedLead.createdById).toBe(10);
    expect(importedLead.employeeId).toBe(5);
    expect(importedLead.assignedToId).toBe(10);
    expect(importedLead.customerRequirements).toBe('Luxury 5-star hotel in Alkapuri Vadodara');

    // Social Media Information in Lead
    expect(importedLead.socialMedia).toBeDefined();
    expect(importedLead.socialMedia.facebook).toBe('https://facebook.com/grandhyattvadodara');
    expect(importedLead.socialMedia.instagram).toBe('https://instagram.com/grandhyattvadodara');
    expect(importedLead.socialMedia.linkedin).toBe('https://linkedin.com/company/grandhyattvadodara');

    // Social Profiles table creation
    expect(socialProfiles.length).toBeGreaterThanOrEqual(3);
    const platforms = socialProfiles.map((p) => p.platform);
    expect(platforms).toContain('FACEBOOK');
    expect(platforms).toContain('INSTAGRAM');
    expect(platforms).toContain('LINKEDIN');

    // Place status update & link
    expect(captures[0].isImported).toBe(true);
    expect(captures[0].importedLeadId).toBe(importedLead.id);
    expect(captures[0].status).toBe('LEAD_CREATED');
  });

  it('duplicate import backfills missing rating, coordinates, and social media without overwriting existing data', async () => {
    // Lead already exists with minimal info (e.g. created manually without rating/reviews/social)
    leads.push({
      id: 50,
      customerId: 2,
      companyName: 'Grand Hyatt Vadodara',
      title: 'Grand Hyatt Vadodara',
      phone: '+912652345678',
      email: null,
      website: null,
      address: null,
      city: null,
      state: null,
      country: null,
      pincode: null,
      googlePlaceId: null,
      rating: null,
      reviewCount: null,
      latitude: null,
      longitude: null,
      socialMedia: null,
      deletedAt: null,
    });

    // Capture record has full information
    captures.push({
      id: 202,
      customerId: 2,
      googlePlaceId: 'ChIJ_GRAND_HYATT_VADODARA',
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
      source: 'GOOGLE_PLACES',
      status: 'CAPTURED',
      socialMedia: {
        facebook: 'https://facebook.com/grandhyattvadodara',
        instagram: 'https://instagram.com/grandhyattvadodara',
      },
      rawData: { city: 'Vadodara', state: 'Gujarat', country: 'India', pincode: '390007' },
    });

    const result = await service.importToLeads(
      2,
      { id: 10, customerId: 2, role: 'ADMIN' },
      { places: [{ id: 202 }] },
    );

    expect(result.imported).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(leads).toHaveLength(1);

    const existingLead = leads[0];
    // Company name was non-empty -> not overwritten
    expect(existingLead.companyName).toBe('Grand Hyatt Vadodara');

    // Missing fields backfilled
    expect(existingLead.email).toBe('reservations@grandhyattvadodara.com');
    expect(existingLead.website).toBe('https://grandhyattvadodara.com/');
    expect(existingLead.address).toBe('R.C. Dutt Road, Alkapuri, Vadodara, Gujarat 390007');
    expect(existingLead.city).toBe('Vadodara');
    expect(existingLead.state).toBe('Gujarat');
    expect(existingLead.country).toBe('India');
    expect(existingLead.pincode).toBe('390007');
    expect(existingLead.googlePlaceId).toBe('ChIJ_GRAND_HYATT_VADODARA');
    expect(existingLead.rating).toBe(4.8);
    expect(existingLead.reviewCount).toBe(1420);
    expect(existingLead.latitude).toBe(22.3123);
    expect(existingLead.longitude).toBe(73.1812);

    // Social Media handles backfilled
    expect(existingLead.socialMedia).toBeDefined();
    expect(existingLead.socialMedia.facebook).toBe('https://facebook.com/grandhyattvadodara');
    expect(existingLead.socialMedia.instagram).toBe('https://instagram.com/grandhyattvadodara');

    // Capture record linked to existing lead
    expect(captures[0].isImported).toBe(true);
    expect(captures[0].importedLeadId).toBe(50);
  });
});

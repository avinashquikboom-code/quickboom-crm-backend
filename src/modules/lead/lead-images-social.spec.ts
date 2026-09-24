import { Test, TestingModule } from '@nestjs/testing';
import { LeadService } from './lead.service';
import { LeadRepository } from './lead.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';

describe('Lead Images, Location & Social Media Backend Tests', () => {
  let leadService: LeadService;
  let mockLeadRepository: any;
  let mockS3Service: any;
  let mockPrisma: any;

  beforeEach(async () => {
    mockLeadRepository = {
      addImage: jest.fn().mockImplementation((leadId, data) =>
        Promise.resolve({
          id: 10,
          leadId,
          url: data.url,
          key: data.key,
          caption: data.caption,
          createdAt: new Date(),
        }),
      ),
      findImageById: jest.fn().mockImplementation((leadId, imageId) =>
        Promise.resolve({
          id: imageId,
          leadId,
          url: 'https://s3.amazonaws.com/bucket/leads/1/100/test.jpg',
          key: 'leads/1/100/test.jpg',
          caption: 'Office photo',
          createdAt: new Date(),
        }),
      ),
      deleteImage: jest.fn().mockResolvedValue({ count: 1 }),
      logTimeline: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ count: 1 }),
    };

    mockS3Service = {
      uploadFile: jest.fn().mockResolvedValue({
        imageUrl: 'https://s3.amazonaws.com/bucket/leads/1/100/uploaded.jpg',
        imageKey: 'leads/1/100/uploaded.jpg',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          customerId: 1,
          title: 'Acme Test Corp',
          address: '42 Wallaby Way',
          city: 'Sydney',
          state: 'NSW',
          country: 'Australia',
          pincode: '2000',
          latitude: -33.8688,
          longitude: 151.2093,
          website: 'https://acme.com',
          socialMedia: {
            instagram: 'https://instagram.com/acme',
            facebook: 'https://facebook.com/acme',
          },
          images: [],
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 100,
          customerId: 1,
          socialMedia: {
            instagram: 'https://instagram.com/acme',
          },
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        { provide: LeadRepository, useValue: mockLeadRepository },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: mockS3Service },
      ],
    }).compile();

    leadService = module.get<LeadService>(LeadService);
    // Mock getLeadById
    jest.spyOn(leadService, 'getLeadById').mockResolvedValue({
      id: 100,
      customerId: 1,
      title: 'Acme Test Corp',
      address: '42 Wallaby Way',
      city: 'Sydney',
      state: 'NSW',
      country: 'Australia',
      pincode: '2000',
      latitude: -33.8688,
      longitude: 151.2093,
      website: 'https://acme.com',
      socialMedia: {
        instagram: 'https://instagram.com/acme',
      },
      images: [],
    } as any);
  });

  it('uploads image file via S3Service and saves LeadImage record', async () => {
    const fakeFile: any = {
      buffer: Buffer.from('fake image content'),
      mimetype: 'image/jpeg',
      originalname: 'shop.jpg',
      size: 1024,
    };

    const result = await leadService.addImage(1, 100, fakeFile, { caption: 'Store front' });

    expect(mockS3Service.uploadFile).toHaveBeenCalledWith(fakeFile, 'leads/1/100');
    expect(mockLeadRepository.addImage).toHaveBeenCalledWith(100, {
      url: 'https://s3.amazonaws.com/bucket/leads/1/100/uploaded.jpg',
      key: 'leads/1/100/uploaded.jpg',
      caption: 'Store front',
    });
    expect(mockLeadRepository.logTimeline).toHaveBeenCalledWith(100, 'IMAGE_ADDED', expect.any(String));
    expect(result.id).toBe(10);
  });

  it('adds image by URL without file upload', async () => {
    const result = await leadService.addImage(1, 100, undefined, {
      url: 'https://cdn.example.com/product.png',
      caption: 'Product display',
    });

    expect(mockS3Service.uploadFile).not.toHaveBeenCalled();
    expect(mockLeadRepository.addImage).toHaveBeenCalledWith(100, {
      url: 'https://cdn.example.com/product.png',
      key: undefined,
      caption: 'Product display',
    });
    expect(result.url).toBe('https://cdn.example.com/product.png');
  });

  it('deletes lead image from S3 and database', async () => {
    const result = await leadService.deleteImage(1, 100, 10);

    expect(mockLeadRepository.findImageById).toHaveBeenCalledWith(100, 10);
    expect(mockS3Service.deleteFile).toHaveBeenCalledWith('leads/1/100/test.jpg');
    expect(mockLeadRepository.deleteImage).toHaveBeenCalledWith(100, 10);
    expect(mockLeadRepository.logTimeline).toHaveBeenCalledWith(100, 'IMAGE_DELETED', expect.any(String));
    expect(result.success).toBe(true);
  });

  it('updates location and social media via updateLead', async () => {
    await leadService.updateLead(1, 100, {
      address: '100 Marine Drive',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      pincode: '400020',
      latitude: 18.9432,
      longitude: 72.8234,
      socialMedia: {
        instagram: 'https://instagram.com/acme_india',
        linkedin: 'https://linkedin.com/company/acme',
        youtube: 'https://youtube.com/@acme',
      },
    });

    expect(mockLeadRepository.update).toHaveBeenCalledWith(
      1,
      100,
      expect.objectContaining({
        address: '100 Marine Drive',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        pincode: '400020',
        latitude: 18.9432,
        longitude: 72.8234,
        socialMedia: {
          instagram: 'https://instagram.com/acme_india',
          linkedin: 'https://linkedin.com/company/acme',
          youtube: 'https://youtube.com/@acme',
        },
      }),
    );
  });
});

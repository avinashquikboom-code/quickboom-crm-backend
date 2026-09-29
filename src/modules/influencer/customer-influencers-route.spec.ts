import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import * as request from 'supertest';
import { InfluencerController } from './influencer.controller';
import { InfluencerService } from './influencer.service';
import { CustomerController } from '../customer/customer.controller';
import { CustomerService } from '../customer/customer.service';
import { WorkService } from '../work/work.service';
import { AiCreditService } from '../ai-studio/ai-credit.service';
import { S3Service } from '../s3/s3.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * Regression: GET /customer/influencers must NOT hit CustomerController GET /customer/:id
 * (which treated id="influencers" as a customer PK and threw Invalid customer ID).
 */
describe('Customer influencers route resolution', () => {
  let app: INestApplication;
  let customerFindOne: jest.Mock;

  const mockInfluencers = [{ id: 1, name: 'Creator A', isFeatured: true }];

  beforeAll(async () => {
    customerFindOne = jest.fn().mockImplementation(() => {
      throw new BadRequestException('Invalid customer ID');
    });
    const customerService = {
      findOne: customerFindOne,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [InfluencerController, CustomerController],
      providers: [
        { provide: InfluencerService, useValue: { getActiveInfluencers: jest.fn().mockResolvedValue(mockInfluencers) } },
        { provide: CustomerService, useValue: customerService },
        { provide: WorkService, useValue: {} },
        { provide: AiCreditService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/customer/influencers?featured=true returns 200 and influencer list (not Invalid customer ID)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/customer/influencers')
      .query({ featured: true })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(mockInfluencers);
    expect(customerFindOne).not.toHaveBeenCalled();
  });
});

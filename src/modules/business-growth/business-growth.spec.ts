import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateCampaignDto,
  UpdateCampaignBudgetDto,
  UpdateCampaignStatusDto,
  UpdateBusinessProfileDto,
  ReplyReviewDto,
  GenerateAiReplyDto,
  SelectLocationDto,
} from './dto/business-growth.dto';

describe('BusinessGrowth DTO Validation', () => {
  it('validates CreateCampaignDto with the exact payload from the user request', async () => {
    const payload = {
      name: 'Search - Winter Enterprise Lead Acquisition',
      objective: 'LEADS',
      budgetDaily: 2500,
      bidStrategy: 'TARGET_CPA',
      targetLocations: ['Mumbai', 'Pune', 'Ahmedabad', 'Bengaluru'],
      finalUrl: 'https://quikboom.com/enterprise-crm',
    };

    const instance = plainToInstance(CreateCampaignDto, payload);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBe(0);
    expect(instance.name).toBe('Search - Winter Enterprise Lead Acquisition');
    expect(instance.budgetDaily).toBe(2500);
    expect(instance.finalUrl).toBe('https://quikboom.com/enterprise-crm');
  });

  it('validates budgetDaily string conversion to number', async () => {
    const payload = {
      name: 'Performance Max Q4',
      budgetDaily: '3500',
      finalUrl: 'https://quikboom.com/trial',
    };

    const instance = plainToInstance(CreateCampaignDto, payload);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBe(0);
    expect(instance.budgetDaily).toBe(3500);
  });

  it('rejects missing finalUrl or name', async () => {
    const payload = {
      budgetDaily: 1500,
    };

    const instance = plainToInstance(CreateCampaignDto, payload);
    const errors = await validate(instance);

    expect(errors.length).toBeGreaterThan(0);
    const propertyNames = errors.map((e) => e.property);
    expect(propertyNames).toContain('name');
    expect(propertyNames).toContain('finalUrl');
  });

  it('validates UpdateCampaignBudgetDto', async () => {
    const instance = plainToInstance(UpdateCampaignBudgetDto, {
      dailyBudget: 4200,
      reason: 'Scaling festive traffic',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBe(0);
  });

  it('validates UpdateCampaignStatusDto', async () => {
    const instance = plainToInstance(UpdateCampaignStatusDto, { status: 'PAUSED' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBe(0);
  });

  it('validates ReplyReviewDto', async () => {
    const instance = plainToInstance(ReplyReviewDto, {
      replyText: 'Thank you for your feedback!',
      isAiGenerated: true,
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBe(0);
  });

  it('validates SelectLocationDto with valid and invalid payloads', async () => {
    const valid = plainToInstance(SelectLocationDto, {
      locationId: 'locations/quik-boom-marketing-agency',
    });
    const validErrors = await validate(valid, { whitelist: true, forbidNonWhitelisted: true });
    expect(validErrors.length).toBe(0);

    const invalid = plainToInstance(SelectLocationDto, { locationId: '' });
    const invalidErrors = await validate(invalid);
    expect(invalidErrors.length).toBeGreaterThan(0);
  });
});

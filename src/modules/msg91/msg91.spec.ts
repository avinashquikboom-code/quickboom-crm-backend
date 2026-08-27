import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Msg91Service } from './msg91.service';
import { BadRequestException } from '@nestjs/common';

describe('Msg91Service', () => {
  let service: Msg91Service;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Msg91Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'MSG91_AUTH_KEY') return 'test_msg91_auth_key_12345';
              if (key === 'MSG91_TEMPLATE_ID') return '60b9f9123456789';
              if (key === 'MSG91_SENDER_ID') return 'QKBOM';
              if (key === 'MSG91_OTP_EXPIRY') return '10';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<Msg91Service>(Msg91Service);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Indian Mobile Number Normalization', () => {
    it('normalizes 10-digit Indian numbers to 91XXXXXXXXXX', () => {
      expect(service.normalizeMobile('9876543210')).toBe('919876543210');
      expect(service.normalizeMobile('7890123456')).toBe('917890123456');
    });

    it('handles numbers with +91 prefix', () => {
      expect(service.normalizeMobile('+919876543210')).toBe('919876543210');
      expect(service.normalizeMobile('+91 98765 43210')).toBe('919876543210');
    });

    it('handles numbers with leading 0', () => {
      expect(service.normalizeMobile('09876543210')).toBe('919876543210');
    });

    it('handles numbers already with 91 prefix without adding duplicate 91', () => {
      expect(service.normalizeMobile('919876543210')).toBe('919876543210');
    });

    it('extracts clean 10-digit mobile number', () => {
      expect(service.extract10DigitMobile('+919876543210')).toBe('9876543210');
      expect(service.extract10DigitMobile('9876543210')).toBe('9876543210');
    });

    it('rejects invalid numbers not starting with 6, 7, 8, 9', () => {
      expect(() => service.normalizeMobile('1234567890')).toThrow(BadRequestException);
      expect(() => service.normalizeMobile('5555555555')).toThrow(BadRequestException);
      expect(() => service.normalizeMobile('abc')).toThrow(BadRequestException);
      expect(() => service.normalizeMobile('123')).toThrow(BadRequestException);
    });

    it('masks mobile number for safe diagnostics', () => {
      expect(service.maskMobile('9876543210')).toBe('9198XXXX3210');
    });
  });

  describe('OTP Dispatch', () => {
    it('dispatches OTP successfully', async () => {
      const result = await service.sendOtp('9876543210', '123456');
      expect(result.success).toBe(true);
      expect(result.message).toContain('OTP sent');
    });
  });
});

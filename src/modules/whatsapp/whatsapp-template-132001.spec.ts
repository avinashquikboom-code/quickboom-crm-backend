import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { WhatsappService, WHATSAPP_ERROR_CODES } from './whatsapp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { LeadService } from '../lead/lead.service';
import { LeadRepository } from '../lead/lead.repository';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { PlanAccessService } from '../subscription/plan-access.service';
import { LeadLimitService } from '../lead-limit/lead-limit.service';
import { LeadStatus } from '@prisma/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WhatsApp Error #132001 Tracing & Pre-Send Validation Tests', () => {
  let whatsappService: WhatsappService;
  let leadService: LeadService;
  let mockPrisma: any;
  let mockIntegrationSettings: any;

  const validConfig = {
    provider: 'WHATSAPP',
    isEnabled: true,
    credentials: {
      apiKey: 'test-meta-access-token-secret-xyz',
      phoneNumberId: '109876543210',
      businessAccountId: 'WABA_123456789',
      apiVersion: 'v25.0',
    },
  };

  const templatesInDb: Record<number, any> = {
    7: {
      id: 7,
      name: 'Final Call Stage WhatsApp',
      templateName: 'lead_stage_final_call',
      language: 'en',
      category: 'UTILITY',
      status: 'APPROVED',
      metaTemplateId: 'meta_tpl_final_call_123',
      body: 'Hello {{leadName}}, this is your final call regarding {{companyName}}.',
      isLocalActive: true,
      deletedAt: null,
    },
    11: {
      id: 11,
      name: 'Follow Up Stage WhatsApp',
      templateName: 'lead_stage_follow_up',
      language: 'en',
      category: 'UTILITY',
      status: 'APPROVED',
      metaTemplateId: 'meta_tpl_follow_up_456',
      body: 'Hello {{leadName}}, following up on {{companyName}}.',
      isLocalActive: true,
      deletedAt: null,
    },
    20: {
      id: 20,
      name: 'US English Template',
      templateName: 'lead_stage_us_english',
      language: 'en_US',
      category: 'UTILITY',
      status: 'APPROVED',
      metaTemplateId: 'meta_tpl_us_789',
      body: 'Hello {{leadName}}, scheduled for {{startDate}}.',
      isLocalActive: true,
      deletedAt: null,
    },
    30: {
      id: 30,
      name: 'Pending Template',
      templateName: 'lead_stage_pending_tpl',
      language: 'en',
      category: 'UTILITY',
      status: 'PENDING',
      metaTemplateId: 'meta_tpl_pending_001',
      body: 'Pending review',
      isLocalActive: true,
      deletedAt: null,
    },
    31: {
      id: 31,
      name: 'Rejected Template',
      templateName: 'lead_stage_rejected_tpl',
      language: 'en',
      category: 'UTILITY',
      status: 'REJECTED',
      metaTemplateId: 'meta_tpl_rejected_002',
      body: 'Rejected template',
      isLocalActive: true,
      deletedAt: null,
    },
    40: {
      id: 40,
      name: 'Different WABA Template',
      templateName: 'lead_stage_diff_waba',
      language: 'en',
      category: 'UTILITY',
      status: 'APPROVED',
      metaTemplateId: 'meta_tpl_waba_diff',
      body: 'Different WABA',
      isLocalActive: true,
      deletedAt: null,
    },
  };

  let leadsTable: any[] = [];
  let stagesTable: any[] = [];

  beforeEach(async () => {
    jest.clearAllMocks();

    mockIntegrationSettings = {
      getIntegrationConfig: jest.fn().mockResolvedValue(validConfig),
    };

    leadsTable = [
      {
        id: 501,
        customerId: 1,
        title: 'Acme Enterprise',
        firstName: 'Rahul',
        lastName: 'Sharma',
        email: 'rahul@example.com',
        phone: '+919876543210',
        companyName: 'Acme Enterprise',
        source: 'WEBSITE',
        status: LeadStatus.FOLLOW_UP,
        stageId: 3,
        deletedAt: null,
      },
      {
        id: 502,
        customerId: 1,
        title: 'Global Corp',
        firstName: 'Pooja',
        lastName: 'Patil',
        email: 'pooja@example.com',
        phone: '+919876543210',
        companyName: 'Global Corp',
        source: 'WEBSITE',
        status: LeadStatus.FOLLOW_UP,
        stageId: 3,
        deletedAt: null,
      },
    ];

    stagesTable = [
      {
        id: 3,
        customerId: null,
        name: 'Follow-up',
        key: 'FOLLOW_UP',
        isActive: true,
        whatsappEnabled: true,
        whatsappTemplateId: 11,
        deletedAt: null,
      },
      {
        id: 9,
        customerId: null,
        name: 'Final Call',
        key: 'FINAL_CALL',
        isActive: true,
        whatsappEnabled: true,
        whatsappTemplateId: 7, // points to template 7: lead_stage_final_call (APPROVED, 'en')
        deletedAt: null,
      },
      {
        id: 15,
        customerId: null,
        name: 'Broken Stage',
        key: 'BROKEN_STAGE',
        isActive: true,
        whatsappEnabled: true,
        whatsappTemplateId: 9999, // does not exist in templatesInDb
        deletedAt: null,
      },
    ];

    mockPrisma = {
      metaTemplate: {
        findUnique: jest.fn().mockImplementation((args: any) => {
          const where = args?.where || {};
          if (where.id) {
            return Promise.resolve(templatesInDb[where.id] || null);
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockImplementation((args: any) => {
          const where = args?.where || {};
          if (where.id) {
            return Promise.resolve(templatesInDb[where.id] || null);
          }
          if (where.templateName) {
            const found = Object.values(templatesInDb).find(
              (t: any) => t.templateName === where.templateName,
            );
            return Promise.resolve(found || null);
          }
          if (where.OR && Array.isArray(where.OR)) {
            for (const cond of where.OR) {
              if (cond.templateName) {
                const found = Object.values(templatesInDb).find(
                  (t: any) => t.templateName === cond.templateName,
                );
                if (found) return Promise.resolve(found);
              }
            }
          }
          return Promise.resolve(null);
        }),
      },
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
      lead: {
        findFirst: jest.fn(async ({ where }: any) => {
          return leadsTable.find((l) => l.id === where.id && (where.customerId ? l.customerId === where.customerId : true)) || null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          return leadsTable.find((l) => l.id === where.id) || null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const lead = leadsTable.find((l) => l.id === where.id);
          if (lead) {
            Object.assign(lead, data);
            return lead;
          }
          return null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const lead = leadsTable.find((l) => l.id === where.id);
          if (lead) {
            Object.assign(lead, data);
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      leadStage: {
        findFirst: jest.fn(async ({ where }: any) => {
          return stagesTable.find((s) => s.id === where.id || s.key === where.key) || null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          return stagesTable.find((s) => s.id === where.id) || null;
        }),
        findMany: jest.fn(async () => stagesTable),
      },
      leadTimeline: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      leadActivityTimeline: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      leadStatusHistory: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      notification: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      emailTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        LeadService,
        LeadRepository,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IntegrationSettingsService, useValue: mockIntegrationSettings },
        {
          provide: EmailService,
          useValue: { sendLeadNotification: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: EmailTemplateService,
          useValue: { renderTemplate: jest.fn(), findByKey: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: PlanAccessService,
          useValue: { checkPlanFeature: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: LeadLimitService,
          useValue: { checkLeadLimit: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    whatsappService = module.get<WhatsappService>(WhatsappService);
    leadService = module.get<LeadService>(LeadService);

    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({
      data: {
        verified_name: 'Verified Business Account',
        code_verification_status: 'VERIFIED',
      },
    } as any);
  });

  // =========================================================================
  // TEST 1: Approved template (exact Meta name & language) -> sends successfully
  // =========================================================================
  it('TEST 1: Approved template with exact Meta name and language sends successfully', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        messaging_product: 'whatsapp',
        contacts: [{ input: '919876543210', wa_id: '919876543210' }],
        messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
      },
    });

    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_final_call',
      [{ type: 'text', text: 'Avinash' }],
      'en',
      undefined,
      'Final Call',
      1,
      1,
      {
        templateId: 7,
        providerTemplateId: 'meta_tpl_final_call_123',
        templateStatus: 'APPROVED',
        isApproved: true,
      },
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('wamid.HBgLMTIzNDU2Nzg5MA==');

    // Verify exact URL and payload
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [callUrl, callPayload, callConfig] = mockedAxios.post.mock.calls[0];

    expect(callUrl).toBe('https://graph.facebook.com/v25.0/109876543210/messages');
    expect(callPayload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'lead_stage_final_call',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: 'Avinash' }],
          },
        ],
      },
    });

    // Ensure access token is never logged or exposed in payload
    expect(callConfig.headers.Authorization).toBe('Bearer test-meta-access-token-secret-xyz');
  });

  // =========================================================================
  // TEST 2: Wrong language: Meta = en_US, Requested = en -> Pre-send validation detects mismatch
  // =========================================================================
  it('TEST 2: Wrong language detected by pre-send validation without calling Meta Graph API', async () => {
    // Template 20 in DB has language 'en_US'
    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_us_english',
      [{ type: 'text', text: 'Raj' }],
      'en', // mismatch with DB's 'en_US'
      undefined,
      'Contacted',
      1,
      1,
      {
        templateId: 20,
      },
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('TEMPLATE_LANGUAGE_MISMATCH');
    expect(result.message).toContain("is not approved for language 'en'");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 3: Wrong template name -> Pre-send validation detects missing template
  // =========================================================================
  it('TEST 3: Wrong template name detected by pre-send validation without calling Meta Graph API', async () => {
    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'non_existent_meta_template',
      [{ type: 'text', text: 'Raj' }],
      'en',
      undefined,
      'Contacted',
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('TEMPLATE_NOT_FOUND');
    expect(result.message).toContain('does not exist in local template configuration');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 4: Template pending/rejected -> Message is not sent
  // =========================================================================
  it('TEST 4: Pending template is blocked by pre-send validation', async () => {
    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_pending_tpl',
      [{ type: 'text', text: 'Raj' }],
      'en',
      undefined,
      'Contacted',
      1,
      1,
      {
        templateId: 30,
        templateStatus: 'PENDING',
      },
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('TEMPLATE_PENDING');
    expect(result.message).toContain('PENDING');
    expect(result.message).toContain('Only APPROVED templates can be sent');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('TEST 4b: Rejected template is blocked by pre-send validation', async () => {
    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_rejected_tpl',
      [{ type: 'text', text: 'Raj' }],
      'en',
      undefined,
      'Contacted',
      1,
      1,
      {
        templateId: 31,
        templateStatus: 'REJECTED',
      },
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('TEMPLATE_REJECTED');
    expect(result.message).toContain('REJECTED');
    expect(result.message).toContain('Only APPROVED templates can be sent');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 5: Template belongs to different WABA -> Validation fails safely
  // =========================================================================
  it('TEST 5: Template belonging to a different WABA is detected and rejected safely', async () => {
    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_diff_waba',
      [{ type: 'text', text: 'Raj' }],
      'en',
      undefined,
      'Contacted',
      1,
      1,
      {
        templateId: 40,
        wabaId: 'DIFFERENT_WABA_999999', // config has WABA_123456789
      },
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('WABA_MISMATCH');
    expect(result.message).toContain('DIFFERENT_WABA_999999');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 6: Lead Stage Automation: FOLLOW UP -> FINAL CALL
  // Selected approved WhatsApp template sends with exact Meta name & language
  // =========================================================================
  it('TEST 6: Lead stage automation FOLLOW UP -> FINAL CALL sends approved template', async () => {
    // Mock Meta Cloud API response
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        messaging_product: 'whatsapp',
        contacts: [{ input: '919876543210', wa_id: '919876543210' }],
        messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
      },
    });

    const updateResult = await leadService.updateStatus(1, 501, 1, { stageId: 9 });

    expect(updateResult).toBeDefined();
    expect(updateResult.stageId).toBe(9);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const [postUrl, postPayload] = mockedAxios.post.mock.calls[0];
    const payload = postPayload as any;
    expect(postUrl).toBe('https://graph.facebook.com/v25.0/109876543210/messages');
    expect(payload.template.name).toBe('lead_stage_final_call');
    expect(payload.template.language.code).toBe('en');
    expect(payload.to).toBe('919876543210');
  });

  // =========================================================================
  // TEST 7: Lead stage automation with invalid template (Failure-Isolation)
  // Lead stage update still succeeds while WhatsApp reports template error
  // =========================================================================
  it('TEST 7: Lead stage update succeeds even when WhatsApp template validation fails (failure-isolation)', async () => {
    // Execute stage change to broken stage (id: 15 with whatsappTemplateId: 9999)
    const updateResult = await leadService.updateStatus(1, 502, 1, { stageId: 15 });

    // Lead stage update must SUCCEED (failure-isolation)
    expect(updateResult).toBeDefined();
    expect(updateResult.stageId).toBe(15);
    expect(mockPrisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 502 }),
        data: expect.objectContaining({ stageId: 15 }),
      }),
    );
    // Meta API must NOT have been called with an invalid template
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  // =========================================================================
  // TEST 8: Meta API Returns #132001 -> Safe logging & structured error
  // =========================================================================
  it('TEST 8: Meta API error #132001 is captured, safely logged, and returned with full details', async () => {
    // Simulate Meta API returning 132001 error response
    mockedAxios.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: {
            message: '(#132001) Template name does not exist in the translation',
            type: 'OAuthException',
            code: 132001,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'template name (lead_stage_final_call) does not exist in en',
            },
            error_subcode: 2388040,
            fbtrace_id: 'AQwErTyUiOp12345',
          },
        },
      },
    });

    const result = await whatsappService.sendTemplate(
      '+91 98765 43210',
      'lead_stage_final_call',
      [{ type: 'text', text: 'Avinash' }],
      'en',
      undefined,
      'Final Call',
      1,
      1,
      {
        templateId: 7,
      },
    );

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.errorCode).toBe(WHATSAPP_ERROR_CODES.TEMPLATE_ERROR);
    expect(result.metaErrorCode).toBe(132001);
    expect(result.metaErrorType).toBe('OAuthException');
    expect(result.metaErrorMessage).toBe('(#132001) Template name does not exist in the translation');
    expect(result.fbtraceId).toBe('AQwErTyUiOp12345');
    expect(result.providerStatus).toBe(400);
  });
});

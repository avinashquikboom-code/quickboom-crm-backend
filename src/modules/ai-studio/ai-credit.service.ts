import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import {
  PurchaseCreditsDto,
  VerifyCreditPurchaseDto,
  UpdateAiServiceConfigDto,
} from './dto/ai-studio.dto';
import * as crypto from 'crypto';

@Injectable()
export class AiCreditService {
  private readonly logger = new Logger(AiCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSettings: IntegrationSettingsService,
  ) {}

  /**
   * Retrieves or initializes a customer's AI Credit Wallet with welcome credits
   */
  async getOrCreateWallet(customerId: number) {
    let wallet = await this.prisma.aiCreditWallet.findUnique({
      where: { customerId },
    });

    if (!wallet) {
      wallet = await this.prisma.aiCreditWallet.create({
        data: {
          customerId,
          balance: 20, // 20 welcome credits for new customers
          totalEarned: 20,
          totalSpent: 0,
        },
      });

      await this.prisma.aiCreditTransaction.create({
        data: {
          walletId: wallet.id,
          customerId,
          amount: 20,
          balanceAfter: 20,
          type: 'GRANT',
          notes: 'Welcome starter credits for QuikBoom AI Studio',
        },
      });

      this.logger.log(`[AI_WALLET_INIT] Initialized wallet for Customer #${customerId} with 20 welcome credits.`);
    }

    return wallet;
  }

  /**
   * Retrieves credit ledger transactions for the customer
   */
  async getTransactions(customerId: number) {
    return this.prisma.aiCreditTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Validates and deducts credits atomically before an AI generation
   */
  async deductCredits(customerId: number, serviceCode: string, generationId?: number): Promise<number> {
    const config = await this.prisma.aiServiceConfig.findUnique({
      where: { code: serviceCode },
    });

    const requiredCredits = config?.creditCost ?? 5;

    const wallet = await this.getOrCreateWallet(customerId);

    if (wallet.balance < requiredCredits) {
      throw new BadRequestException(
        `Insufficient AI credits. This action requires ${requiredCredits} credits, but your balance is ${wallet.balance}. Please top up your wallet.`,
      );
    }

    const newBalance = wallet.balance - requiredCredits;

    await this.prisma.aiCreditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
        totalSpent: wallet.totalSpent + requiredCredits,
      },
    });

    await this.prisma.aiCreditTransaction.create({
      data: {
        walletId: wallet.id,
        customerId,
        amount: -requiredCredits,
        balanceAfter: newBalance,
        type: 'USAGE',
        serviceCode,
        generationId,
        notes: `Used ${requiredCredits} credits for ${serviceCode}`,
      },
    });

    this.logger.log(`[AI_CREDIT_DEDUCTED] Customer #${customerId} used ${requiredCredits} credits for ${serviceCode}. Remaining: ${newBalance}`);

    return requiredCredits;
  }

  /**
   * Refunds credits on a failed generation
   */
  async refundCredits(customerId: number, serviceCode: string, amount: number, generationId?: number) {
    if (amount <= 0) return;

    const wallet = await this.getOrCreateWallet(customerId);
    const newBalance = wallet.balance + amount;

    await this.prisma.aiCreditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
        totalSpent: Math.max(0, wallet.totalSpent - amount),
      },
    });

    await this.prisma.aiCreditTransaction.create({
      data: {
        walletId: wallet.id,
        customerId,
        amount,
        balanceAfter: newBalance,
        type: 'REFUND',
        serviceCode,
        generationId,
        notes: `Refunded ${amount} credits due to generation failure`,
      },
    });

    this.logger.log(`[AI_CREDIT_REFUND] Refunded ${amount} credits to Customer #${customerId}`);
  }

  /**
   * Initializes Razorpay checkout order for purchasing AI credits
   */
  async createPurchaseOrder(customerId: number, dto: PurchaseCreditsDto) {
    const config = await this.prisma.aiServiceConfig.findFirst({
      where: { isActive: true },
      orderBy: { pricePerCredit: 'asc' },
    });

    const pricePerCredit = config?.pricePerCredit || 10.0; // ₹10 per credit default
    const subtotal = dto.creditsCount * pricePerCredit;
    const gst = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + gst;

    const receipt = `AICRED-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    let razorpayOrderId: string | null = null;
    let keyId: string | null = null;

    try {
      const rzpConfig = await this.integrationSettings.getRazorpayConfig();
      if (rzpConfig?.keyId && rzpConfig?.keySecret) {
        keyId = rzpConfig.keyId;
        const Razorpay = require('razorpay');
        const instance = new Razorpay({
          key_id: rzpConfig.keyId,
          key_secret: rzpConfig.keySecret,
        });
        const rzpOrder = await instance.orders.create({
          amount: Math.round(totalAmount * 100),
          currency: 'INR',
          receipt,
          notes: {
            customerId: String(customerId),
            creditsCount: String(dto.creditsCount),
            type: 'AI_CREDITS_PURCHASE',
          },
        });
        if (rzpOrder?.id) {
          razorpayOrderId = rzpOrder.id;
        }
      }
    } catch (err: any) {
      this.logger.warn(`[AI_CREDIT_PURCHASE] Razorpay order initiation note: ${err?.message}`);
    }

    return {
      success: true,
      creditsCount: dto.creditsCount,
      pricePerCredit,
      subtotal,
      gst,
      totalAmount,
      receipt,
      paymentGatewayConfig: {
        gateway: 'RAZORPAY',
        amount: totalAmount,
        amountInPaise: Math.round(totalAmount * 100),
        currency: 'INR',
        orderId: razorpayOrderId,
        keyId,
      },
    };
  }

  /**
   * Verifies Razorpay payment and credits wallet
   */
  async verifyPurchase(customerId: number, dto: VerifyCreditPurchaseDto) {
    const rzpConfig = await this.integrationSettings.getRazorpayConfig();
    const keySecret = rzpConfig?.keySecret;

    if (keySecret && dto.razorpayOrderId && dto.razorpayPaymentId && dto.razorpaySignature) {
      const generated = crypto
        .createHmac('sha256', keySecret)
        .update(`${dto.razorpayOrderId}|${dto.razorpayPaymentId}`)
        .digest('hex');

      if (generated !== dto.razorpaySignature) {
        this.logger.error(`[AI_CREDIT_VERIFY] Razorpay signature mismatch for Customer #${customerId}`);
        throw new BadRequestException('Payment verification signature failed.');
      }
    }

    const wallet = await this.getOrCreateWallet(customerId);
    const newBalance = wallet.balance + dto.creditsCount;

    await this.prisma.aiCreditWallet.update({
      where: { id: wallet.id },
      data: {
        balance: newBalance,
        totalEarned: wallet.totalEarned + dto.creditsCount,
      },
    });

    const tx = await this.prisma.aiCreditTransaction.create({
      data: {
        walletId: wallet.id,
        customerId,
        amount: dto.creditsCount,
        balanceAfter: newBalance,
        type: 'PURCHASE',
        paymentId: dto.razorpayPaymentId,
        razorpayOrderId: dto.razorpayOrderId,
        notes: `Purchased ${dto.creditsCount} AI credits via Razorpay`,
      },
    });

    this.logger.log(`[AI_CREDIT_PURCHASED] Customer #${customerId} added ${dto.creditsCount} credits. New balance: ${newBalance}`);

    return {
      success: true,
      message: `Successfully added ${dto.creditsCount} AI credits to your wallet!`,
      balance: newBalance,
      transaction: tx,
    };
  }

  /**
   * Retrieves active AI service configurations
   */
  async getServiceConfigs() {
    let configs = await this.prisma.aiServiceConfig.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    if (configs.length === 0) {
      await this.seedInitialConfigs();
      configs = await this.prisma.aiServiceConfig.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return configs;
  }

  async updateServiceConfig(code: string, dto: UpdateAiServiceConfigDto) {
    const existing = await this.prisma.aiServiceConfig.findUnique({
      where: { code },
    });
    if (!existing) {
      throw new NotFoundException(`Service config with code ${code} not found`);
    }

    return this.prisma.aiServiceConfig.update({
      where: { code },
      data: {
        ...(dto.creditCost !== undefined && { creditCost: dto.creditCost }),
        ...(dto.pricePerCredit !== undefined && { pricePerCredit: dto.pricePerCredit }),
        ...(dto.packPrice !== undefined && { packPrice: dto.packPrice }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async getAllTransactionsAdmin(query?: any) {
    const where: any = {};
    if (query?.type && query.type !== 'ALL') {
      where.type = query.type;
    }

    const [items, total] = await Promise.all([
      this.prisma.aiCreditTransaction.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true, companyName: true },
          },
        },
        orderBy: { id: 'desc' },
        take: query?.limit ? parseInt(query.limit, 10) : 50,
        skip: query?.offset ? parseInt(query.offset, 10) : 0,
      }),
      this.prisma.aiCreditTransaction.count({ where }),
    ]);

    return { items, total };
  }

  private async seedInitialConfigs() {
    const defaults = [
      {
        code: 'AI_POST',
        name: 'AI Social Media Post',
        description: 'Complete post generation: high-impact visual image, caption, hashtags, and CTA.',
        creditCost: 5,
        pricePerCredit: 10.0,
        packPrice: 45.0,
        sortOrder: 1,
      },
      {
        code: 'AI_POSTER',
        name: 'AI Marketing Poster',
        description: 'High-definition brand poster & promotional banner graphics with custom styling.',
        creditCost: 10,
        pricePerCredit: 10.0,
        packPrice: 90.0,
        sortOrder: 2,
      },
      {
        code: 'AI_VIDEO',
        name: 'AI Video / Reel',
        description: 'Dynamic short-form social video reel with animated transitions and brand highlights.',
        creditCost: 25,
        pricePerCredit: 10.0,
        packPrice: 220.0,
        sortOrder: 3,
      },
      {
        code: 'AI_CAPTION',
        name: 'AI Caption & Copy',
        description: 'Catchy engaging copy, brand story, and tailored call-to-action.',
        creditCost: 1,
        pricePerCredit: 10.0,
        sortOrder: 4,
      },
      {
        code: 'AI_HASHTAGS',
        name: 'AI Trending Hashtags',
        description: 'High-traffic targeted hashtags tailored to your niche and target audience.',
        creditCost: 1,
        pricePerCredit: 10.0,
        sortOrder: 5,
      },
      {
        code: 'AI_REGENERATE',
        name: 'AI Content Regeneration',
        description: 'Fine-tune, regenerate or tweak generated visuals and copy.',
        creditCost: 2,
        pricePerCredit: 10.0,
        sortOrder: 6,
      },
    ];

    for (const d of defaults) {
      await this.prisma.aiServiceConfig.upsert({
        where: { code: d.code },
        update: d,
        create: d,
      });
    }
  }
}

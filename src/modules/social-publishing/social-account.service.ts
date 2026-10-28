import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectSocialAccountDto } from './dto/social-publishing.dto';
import * as crypto from 'crypto';

@Injectable()
export class SocialAccountService {
  private readonly logger = new Logger(SocialAccountService.name);
  private readonly encryptionKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const rawSecret = process.env.JWT_SECRET || 'quikboom_production_secure_token_secret_key_3847291847';
    this.encryptionKey = crypto.createHash('sha256').update(rawSecret).digest();
  }

  private encrypt(text?: string | null): string | null {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  decrypt(text?: string | null): string | null {
    if (!text || !text.includes(':')) return null;
    try {
      const [ivHex, encryptedText] = text.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return null;
    }
  }

  /**
   * Connects or updates a social account for a customer
   */
  async connectAccount(customerId: number, dto: ConnectSocialAccountDto) {
    const platform = dto.platform.toUpperCase();

    const existing = await this.prisma.socialAccount.findFirst({
      where: {
        customerId,
        platform,
        externalAccountId: dto.externalAccountId,
        deletedAt: null,
      },
    });

    const encryptedToken = this.encrypt(dto.accessToken || `tok_${Date.now()}`);
    const encryptedRefresh = this.encrypt(dto.refreshToken);

    if (existing) {
      return this.prisma.socialAccount.update({
        where: { id: existing.id },
        data: {
          accountName: dto.accountName,
          username: dto.username,
          profilePic: dto.profilePic,
          accessTokenEncrypted: encryptedToken,
          refreshTokenEncrypted: encryptedRefresh,
          isConnected: true,
        },
        select: {
          id: true,
          platform: true,
          accountName: true,
          username: true,
          profilePic: true,
          externalAccountId: true,
          isConnected: true,
          createdAt: true,
        },
      });
    }

    return this.prisma.socialAccount.create({
      data: {
        customerId,
        platform,
        accountName: dto.accountName,
        username: dto.username,
        profilePic: dto.profilePic,
        externalAccountId: dto.externalAccountId,
        accessTokenEncrypted: encryptedToken,
        refreshTokenEncrypted: encryptedRefresh,
        isConnected: true,
      },
      select: {
        id: true,
        platform: true,
        accountName: true,
        username: true,
        profilePic: true,
        externalAccountId: true,
        isConnected: true,
        createdAt: true,
      },
    });
  }

  /**
   * Retrieves connected social accounts for the customer (Tokens are masked)
   */
  async getAccounts(customerId: number) {
    return this.prisma.socialAccount.findMany({
      where: { customerId, deletedAt: null, isConnected: true },
      select: {
        id: true,
        platform: true,
        accountName: true,
        username: true,
        profilePic: true,
        externalAccountId: true,
        isConnected: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Disconnects a social account
   */
  async disconnectAccount(customerId: number, id: number) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id, customerId, deletedAt: null },
    });
    if (!account) {
      throw new NotFoundException(`Social account #${id} not found`);
    }

    return this.prisma.socialAccount.update({
      where: { id },
      data: { isConnected: false },
    });
  }

  /**
   * Admin view of all connected accounts across customers
   */
  async getAllAccountsAdmin(query?: any) {
    const where: any = { deletedAt: null };
    if (query?.platform && query.platform !== 'ALL') {
      where.platform = query.platform.toUpperCase();
    }

    const [items, total] = await Promise.all([
      this.prisma.socialAccount.findMany({
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
      this.prisma.socialAccount.count({ where }),
    ]);

    return { items, total };
  }
}

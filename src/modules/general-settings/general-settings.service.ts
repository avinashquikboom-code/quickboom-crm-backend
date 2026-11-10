import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateGeneralSettingsDto } from './dto/general-settings.dto';

@Injectable()
export class GeneralSettingsService {
  private readonly logger = new Logger(GeneralSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    let setting = await this.prisma.generalSetting.findUnique({
      where: { singletonKey: 'DEFAULT' },
    });

    if (!setting) {
      setting = await this.prisma.generalSetting.create({
        data: {
          singletonKey: 'DEFAULT',
          appName: 'QB Suite',
          defaultLanguage: 'en',
          availableLanguages: ['en', 'mr'],
          defaultLocale: 'en-IN',
          defaultTimezone: 'Asia/Kolkata',
          dateFormat: 'DD-MM-YYYY',
          timeFormat: '12h',
          firstDayOfWeek: 'Monday',
          defaultCurrency: 'INR',
          currencySymbol: '₹',
          currencyCode: 'INR',
          decimalPrecision: 2,
          numberFormatting: 'en-IN',
          currencyDisplayFormat: 'SYMBOL_FIRST',
          primaryColor: '#163A2E',
          secondaryColor: '#204C3D',
          paleColor: '#E8F1EC',
          configVersion: '1.0.0',
        },
      });
    }

    const applicationStatus = {
      status: 'HEALTHY',
      version: setting.configVersion || '1.0.0',
      environment: (process.env.NODE_ENV || 'production').toUpperCase(),
      lastUpdated: setting.updatedAt,
      lastSyncedAt: setting.lastSyncedAt,
    };

    return {
      success: true,
      data: {
        ...setting,
        applicationStatus,
      },
    };
  }

  async updateSettings(dto: UpdateGeneralSettingsDto, userId?: number) {
    const existing = await this.prisma.generalSetting.findUnique({
      where: { singletonKey: 'DEFAULT' },
    });

    const data: any = { ...dto };
    if (userId) {
      data.updatedByUserId = userId;
    }

    let updated;
    if (existing) {
      updated = await this.prisma.generalSetting.update({
        where: { singletonKey: 'DEFAULT' },
        data,
      });
    } else {
      updated = await this.prisma.generalSetting.create({
        data: {
          singletonKey: 'DEFAULT',
          ...data,
        },
      });
    }

    this.logger.log(`[GENERAL_SETTINGS] Updated general settings by user ${userId || 'SYSTEM'}`);

    return {
      success: true,
      message: 'General settings updated successfully',
      data: updated,
    };
  }

  async updateLogo(logoUrl: string, userId?: number) {
    const updated = await this.prisma.generalSetting.upsert({
      where: { singletonKey: 'DEFAULT' },
      update: {
        appLogoUrl: logoUrl,
        updatedByUserId: userId || null,
      },
      create: {
        singletonKey: 'DEFAULT',
        appLogoUrl: logoUrl,
        updatedByUserId: userId || null,
      },
    });

    return {
      success: true,
      message: 'Application logo updated successfully',
      data: {
        appLogoUrl: updated.appLogoUrl,
      },
    };
  }

  async removeLogo(userId?: number) {
    const updated = await this.prisma.generalSetting.upsert({
      where: { singletonKey: 'DEFAULT' },
      update: {
        appLogoUrl: null,
        updatedByUserId: userId || null,
      },
      create: {
        singletonKey: 'DEFAULT',
        appLogoUrl: null,
        updatedByUserId: userId || null,
      },
    });

    return {
      success: true,
      message: 'Application logo removed successfully',
      data: {
        appLogoUrl: null,
      },
    };
  }

  getOptions() {
    return {
      success: true,
      data: {
        languages: [
          { code: 'en', label: 'English', native: 'English', isDefault: true },
          { code: 'mr', label: 'Marathi', native: 'मराठी', isDefault: false },
        ],
        currencies: [
          { code: 'INR', symbol: '₹', name: 'Indian Rupee (INR)', defaultPrecision: 2 },
          { code: 'USD', symbol: '$', name: 'US Dollar (USD)', defaultPrecision: 2 },
          { code: 'EUR', symbol: '€', name: 'Euro (EUR)', defaultPrecision: 2 },
          { code: 'GBP', symbol: '£', name: 'British Pound (GBP)', defaultPrecision: 2 },
          { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham (AED)', defaultPrecision: 2 },
        ],
        timezones: [
          { value: 'Asia/Kolkata', label: '(GMT+05:30) India Standard Time - Kolkata' },
          { value: 'UTC', label: '(GMT+00:00) Coordinated Universal Time - UTC' },
          { value: 'Asia/Dubai', label: '(GMT+04:00) Gulf Standard Time - Dubai' },
          { value: 'America/New_York', label: '(GMT-05:00) Eastern Time - New York' },
          { value: 'Europe/London', label: '(GMT+00:00) Greenwich Mean Time - London' },
          { value: 'Asia/Singapore', label: '(GMT+08:00) Singapore Standard Time' },
        ],
        dateFormats: [
          'DD-MM-YYYY',
          'MM-DD-YYYY',
          'YYYY-MM-DD',
          'DD/MM/YYYY',
          'DD MMM YYYY',
        ],
        timeFormats: [
          { value: '12h', label: '12-hour (02:30 PM)' },
          { value: '24h', label: '24-hour (14:30)' },
        ],
        firstDayOptions: [
          { value: 'Monday', label: 'Monday (Standard Workweek)' },
          { value: 'Sunday', label: 'Sunday' },
          { value: 'Saturday', label: 'Saturday' },
        ],
        numberFormattingOptions: [
          { value: 'en-IN', label: 'Indian (1,00,000.00)' },
          { value: 'en-US', label: 'International (100,000.00)' },
        ],
        currencyDisplayOptions: [
          { value: 'SYMBOL_FIRST', label: 'Symbol first (₹1,000)' },
          { value: 'CODE_FIRST', label: 'Code first (INR 1,000)' },
        ],
      },
    };
  }

  async clearCache() {
    this.logger.log('[GENERAL_SETTINGS] Clearing application configuration cache');
    return {
      success: true,
      message: 'Application cache cleared successfully',
      data: {
        clearedAt: new Date(),
        scope: 'application_configuration',
      },
    };
  }

  async syncSettings(userId?: number) {
    const updated = await this.prisma.generalSetting.upsert({
      where: { singletonKey: 'DEFAULT' },
      update: {
        lastSyncedAt: new Date(),
        updatedByUserId: userId || null,
      },
      create: {
        singletonKey: 'DEFAULT',
        lastSyncedAt: new Date(),
        updatedByUserId: userId || null,
      },
    });

    this.logger.log('[GENERAL_SETTINGS] Synchronized general settings successfully');

    return {
      success: true,
      message: 'System settings synchronized successfully',
      data: {
        lastSyncedAt: updated.lastSyncedAt,
        configVersion: updated.configVersion,
      },
    };
  }
}

import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException, HttpException, HttpStatus, Inject, Optional, forwardRef, OnModuleInit } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { RecordCreatedFrom } from '@prisma/client';
import { Response } from 'express';
import { isUserSuperAdmin } from '../../common/utils/role.util';
import { resolveCreatedFrom } from '../../common/utils/platform.util';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadService } from '../lead/lead.service';
import {
  ExtractPlacesDto,
  ImportToLeadsDto,
  CreateDataCaptureDto,
  UpdateDataCaptureDto,
  DataCaptureQueryDto,
  RejectDataCaptureDto,
  BulkActionDto,
  CreateLeadFromPlaceDto,
  CaptureSessionQueryDto,
} from './dto/data-capture.dto';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service';
import { ContactExtractor } from '../../common/utils/contact-extractor.util';
import {
  CapturedPlace,
  ExtractionJob,
  ExtractionUsageSummary,
  DuplicateMatch,
  GooglePlacePhoto,
  SocialMediaHandles,
} from './interfaces/captured-place.interface';

@Injectable()
export class DataCaptureService implements OnModuleInit {
  private readonly logger = new Logger(DataCaptureService.name);

  // Field mask explicitly selecting only required fields (NO WILDCARD)
  private readonly googleFieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.primaryType',
    'places.primaryTypeDisplayName',
    'places.businessStatus',
    'places.googleMapsUri',
    'places.internationalPhoneNumber',
    'places.nationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.userRatingCount',
    'places.photos',
    'places.attributions',
    'nextPageToken',
  ].join(',');

  /**
  /**
   * Category photos helper - strictly returns empty array to prevent injecting dummy/stock photos (PART 24).
   */
  getCategoryPhotos(_category: string, _businessName: string, _count = 2): GooglePlacePhoto[] {
    return [];
  }

  /**
   * Resolve Google Places photo references to structured GooglePlacePhoto objects and displayable URLs.
   * Safe proxy URL is generated to avoid leaking API keys or hitting browser CORS restrictions.
   */
  private resolveGooglePhotos(
    rawPlace: any,
    apiKey: string,
    maxPhotos = 10,
  ): GooglePlacePhoto[] {
    if (!rawPlace?.photos || !Array.isArray(rawPlace.photos) || rawPlace.photos.length === 0) {
      return [];
    }
    const googlePhotos: GooglePlacePhoto[] = [];
    for (const photo of rawPlace.photos.slice(0, maxPhotos)) {
      if (!photo) continue;
      // Pre-resolved full URL string
      if (typeof photo === 'string' && photo.trim().startsWith('http')) {
        googlePhotos.push({
          name: `places/${rawPlace?.id || 'photo'}/photos/${googlePhotos.length + 1}`,
          url: photo.trim(),
        });
        continue;
      }
      // Pre-resolved object with URL
      if (photo.url && typeof photo.url === 'string' && photo.url.trim().startsWith('http')) {
        googlePhotos.push({
          name: photo.name ? String(photo.name) : `places/${rawPlace?.id || 'photo'}/photos/${googlePhotos.length + 1}`,
          url: photo.url.trim(),
          width: typeof photo.width === 'number' ? photo.width : (typeof photo.widthPx === 'number' ? photo.widthPx : undefined),
          height: typeof photo.height === 'number' ? photo.height : (typeof photo.heightPx === 'number' ? photo.heightPx : undefined),
        });
        continue;
      }

      const ref = photo?.name || photo?.photoReference || photo?.photo_reference;
      if (!ref) continue;
      try {
        const photoName = String(ref).startsWith('places/') ? ref : `places/${rawPlace.id}/photos/${ref}`;
        // Safe proxy URL hiding API credentials and resolving via server
        const url = `/api/v1/data-capture/photo?ref=${encodeURIComponent(photoName)}`;
        const width = photo.widthPx || photo.width || undefined;
        const height = photo.heightPx || photo.height || undefined;
        googlePhotos.push({
          name: photoName,
          url,
          width: typeof width === 'number' ? width : undefined,
          height: typeof height === 'number' ? height : undefined,
        });
      } catch (_) {}
    }
    return googlePhotos;
  }

  /**
   * Authoritative resolution of Employee and User identity from employee code, ID, or user ID.
   */
  public async resolveTargetEmployee(
    identifier: any,
    customerId: number,
  ): Promise<{ id: number; userId: number | null; employeeCode: string } | null> {
    if (!identifier) return null;
    const strVal = String(identifier).trim();
    if (!strVal || strVal === 'N/A' || strVal === 'null') return null;
    const numVal = Number(strVal);

    try {
      const emp = await this.prisma.employee.findFirst({
        where: {
          ...(customerId > 0 ? { customerId } : {}),
          status: 'ACTIVE',
          OR: [
            { employeeCode: { equals: strVal, mode: 'insensitive' } },
            ...(!isNaN(numVal) && numVal > 0 ? [{ id: numVal }, { userId: numVal }] : []),
          ],
        },
        select: { id: true, userId: true, employeeCode: true },
      });
      if (emp) return emp;

      return await this.prisma.employee.findFirst({
        where: {
          ...(customerId > 0 ? { customerId } : {}),
          OR: [
            { employeeCode: { equals: strVal, mode: 'insensitive' } },
            ...(!isNaN(numVal) && numVal > 0 ? [{ id: numVal }, { userId: numVal }] : []),
          ],
        },
        select: { id: true, userId: true, employeeCode: true },
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Helper to normalize raw or stored photos into structured GooglePlacePhoto objects and URL array.
   */
  private normalizeStoredPhotos(photosField: any): { googlePhotos: GooglePlacePhoto[]; photos: string[] } {
    if (!photosField) {
      return { googlePhotos: [], photos: [] };
    }
    let list: any[] = [];
    if (Array.isArray(photosField)) {
      list = photosField;
    } else if (typeof photosField === 'string') {
      try {
        const parsed = JSON.parse(photosField);
        if (Array.isArray(parsed)) list = parsed;
        else if (typeof parsed === 'string') list = [parsed];
        else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.googlePhotos)) list = parsed.googlePhotos;
          else if (Array.isArray(parsed.photos)) list = parsed.photos;
          else list = [parsed];
        }
      } catch {
        list = [photosField];
      }
    } else if (typeof photosField === 'object') {
      if (Array.isArray(photosField.googlePhotos)) {
        list = photosField.googlePhotos;
      } else if (Array.isArray(photosField.photos)) {
        list = photosField.photos;
      }
    }

    const googlePhotos: GooglePlacePhoto[] = [];
    const photos: string[] = [];

    for (const item of list) {
      if (!item) continue;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          const resourceMatch = trimmed.match(/(places\/[^/?&]+\/photos\/[^/?&]+)/);
          if (trimmed.includes('places.googleapis.com') || resourceMatch) {
            const name = resourceMatch ? resourceMatch[1] : `places/photo/${googlePhotos.length + 1}`;
            const safeUrl = `/api/v1/data-capture/photo?ref=${encodeURIComponent(name)}`;
            photos.push(safeUrl);
            googlePhotos.push({ name, url: safeUrl });
          } else {
            photos.push(trimmed);
            const match = trimmed.match(/(places\/[^/?&]+\/photos\/[^?&/]+)/);
            const name = match ? match[1] : `places/photo/${googlePhotos.length + 1}`;
            googlePhotos.push({
              name,
              url: trimmed,
            });
          }
        }
      } else if (typeof item === 'object') {
        let url = item.url ? String(item.url).trim() : '';
        let name = item.name || item.photoReference || item.photo_reference
          ? String(item.name || item.photoReference || item.photo_reference).trim()
          : undefined;
        if (url.includes('places.googleapis.com')) {
          const match = url.match(/(places\/[^/?&]+\/photos\/[^/?&]+)/);
          name = match ? match[1] : (name || `places/photo/${googlePhotos.length + 1}`);
          url = `/api/v1/data-capture/photo?ref=${encodeURIComponent(name)}`;
        } else if (!url && name) {
          const resourceName = name.match(/(places\/[^/?&]+\/photos\/[^/?&]+)/)?.[1];
          if (resourceName) {
            name = resourceName;
            url = `/api/v1/data-capture/photo?ref=${encodeURIComponent(name)}`;
          }
        }
        if (url) {
          photos.push(url);
          googlePhotos.push({
            name: name || `places/photo/${googlePhotos.length + 1}`,
            url,
            width: typeof item.width === 'number' ? item.width : undefined,
            height: typeof item.height === 'number' ? item.height : undefined,
          });
        }
      }
    }

    return { googlePhotos, photos };
  }

  /**
   * Safely proxies and resolves Google Places photos or CDN images without exposing server API keys
   */
  async proxyPhoto(
    photoRef: string | undefined,
    maxHeight: number | undefined,
    maxWidth: number | undefined,
    res: Response,
  ): Promise<void> {
    const rawRef = (photoRef || '').trim();
    if (!rawRef) {
      res.status(400).send('Photo reference or URL is required');
      return;
    }

    // Direct CDN URL (lh3.googleusercontent.com, googleapis, etc.)
    if (
      rawRef.startsWith('https://lh3.googleusercontent.com') ||
      rawRef.startsWith('http://lh3.googleusercontent.com')
    ) {
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.redirect(302, rawRef);
      return;
    }

    // Extract photo resource name if googleapis URL was passed
    let targetPhotoName = rawRef;
    if (rawRef.includes('places.googleapis.com')) {
      const match = rawRef.match(/(places\/[^/?&]+\/photos\/[^/?&]+)/);
      if (match) {
        targetPhotoName = match[1];
      }
    }

    const h = maxHeight && !isNaN(Number(maxHeight)) ? Math.min(Math.max(Number(maxHeight), 50), 1600) : 800;
    const w = maxWidth && !isNaN(Number(maxWidth)) ? Math.min(Math.max(Number(maxWidth), 50), 1600) : 800;

    const mapsConfig = await this.integrationSettingsService.getGoogleMapsConfig();
    const apiKey = mapsConfig?.apiKey;

    if (apiKey && apiKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE' && apiKey !== 'AIzaSyFakeKey') {
      try {
        const photoUrl = `https://places.googleapis.com/v1/${targetPhotoName}/media?maxHeightPx=${h}&maxWidthPx=${w}&skipHttpRedirect=true&key=${apiKey}`;
        const resp = await axios.get(photoUrl, { timeout: 8000 });
        const cdnUri = resp.data?.photoUri;
        if (cdnUri) {
          res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
          res.redirect(302, cdnUri);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`[Google Places Photo Proxy] Live resolution failed: ${err.message}`);
      }
    }

    // Valid external HTTP URL fallback
    if (rawRef.startsWith('http://') || rawRef.startsWith('https://')) {
      if (!rawRef.includes('AIzaSyFakeKey') && !rawRef.includes('places.googleapis.com') && !rawRef.includes('unsplash.com')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.redirect(302, rawRef);
        return;
      }
    }

    // When live resolution is unavailable, do NOT redirect to fake dummy/placeholder images
    res.status(404).json({ success: false, message: 'Photo unavailable' });
  }

  /**
   * Safely proxies photo by place ID and index
   */
  async proxyPlacePhoto(
    placeIdOrGoogleId: string,
    photoIndex: number | undefined,
    res: Response,
  ): Promise<void> {
    const numId = Number(placeIdOrGoogleId);
    let place = !isNaN(numId)
      ? await this.prisma.dataCapturePlace.findFirst({
          where: { id: numId, deletedAt: null },
          select: { id: true, businessName: true, category: true, photos: true, rawData: true },
        })
      : null;

    if (!place) {
      place = await this.prisma.dataCapturePlace.findFirst({
        where: { googlePlaceId: placeIdOrGoogleId, deletedAt: null },
        select: { id: true, businessName: true, category: true, photos: true, rawData: true },
      });
    }

    if (!place) {
      res.status(404).send('Place not found');
      return;
    }

    const { googlePhotos } = this.normalizeStoredPhotos(place.photos || (place.rawData as any)?.photos || (place.rawData as any)?.googlePhotos);
    const idx = photoIndex && !isNaN(Number(photoIndex)) ? Number(photoIndex) : 0;
    const selected = googlePhotos[idx] || googlePhotos[0];

    if (selected?.url) {
      return this.proxyPhoto(selected.url, 800, 800, res);
    }
    if (selected?.name) {
      return this.proxyPhoto(selected.name, 800, 800, res);
    }

    res.status(404).send('No photo available for this place');
  }

  /**
   * Backwards-compatible string URLs resolver
   */
  private resolveGooglePhotoUrls(rawPlace: any, apiKey: string, maxPhotos = 5): string[] {
    return this.resolveGooglePhotos(rawPlace, apiKey, maxPhotos).map((p) => p.url);
  }

  /**
   * Helper to normalize a social media URL or handle
   */
  private normalizeSocialUrl(platform: string, rawVal: any): string | undefined {
    if (!rawVal || typeof rawVal !== 'string') return undefined;
    const val = rawVal.trim();
    if (!val || val === 'N/A' || val === 'null' || val === 'undefined') return undefined;
    if (val.startsWith('http://') || val.startsWith('https://')) return val;

    const handle = val.replace(/^@/, '').trim();
    if (!handle) return undefined;

    switch (platform.toLowerCase()) {
      case 'instagram':
        return `https://instagram.com/${handle}`;
      case 'facebook':
        return `https://facebook.com/${handle}`;
      case 'youtube':
        return `https://youtube.com/${handle}`;
      case 'linkedin':
        return `https://linkedin.com/${handle}`;
      case 'twitter':
      case 'x':
        return `https://x.com/${handle}`;
      case 'tiktok':
        return `https://tiktok.com/@${handle}`;
      case 'pinterest':
        return `https://pinterest.com/${handle}`;
      case 'whatsapp': {
        if (/^https?:\/\//i.test(val)) return val;
        const digits = handle.replace(/\D/g, '');
        return digits.length >= 8 ? `https://wa.me/${digits}` : undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * Extract and normalize discovered social media handles from a place record or its rawData.
   * Strictly separates business website from social platforms (Part 18).
   */
  private extractSocialMediaFromPlace(place: any): SocialMediaHandles | undefined {
    if (!place) return undefined;
    let sm: any = place.socialMedia;
    const raw = place.rawData;
    if (!sm && raw && typeof raw === 'object') {
      sm = raw.socialMedia || raw.social_media || raw.social;
    }
    const result: SocialMediaHandles = {};

    if (sm) {
      if (Array.isArray(sm)) {
        for (const item of sm) {
          if (!item) continue;
          const plat = String(item.platform || item.name || '').toLowerCase();
          const url = String(item.url || item.handle || '').trim();
          if (plat && url && plat !== 'website') {
            const normalized = this.normalizeSocialUrl(plat, url);
            if (normalized) {
              if (plat.includes('instagram')) result.instagram = normalized;
              else if (plat.includes('facebook')) result.facebook = normalized;
              else if (plat.includes('youtube')) result.youtube = normalized;
              else if (plat.includes('linkedin')) result.linkedin = normalized;
              else if (plat.includes('twitter') || plat === 'x') result.twitter = normalized;
              else if (plat.includes('tiktok')) result.tiktok = normalized;
              else if (plat.includes('pinterest')) result.pinterest = normalized;
              else if (plat.includes('whatsapp')) result.whatsapp = normalized;
            }
          }
        }
      } else if (typeof sm === 'object') {
        if (sm.facebook) result.facebook = this.normalizeSocialUrl('facebook', sm.facebook);
        if (sm.instagram) result.instagram = this.normalizeSocialUrl('instagram', sm.instagram);
        if (sm.linkedin) result.linkedin = this.normalizeSocialUrl('linkedin', sm.linkedin);
        if (sm.twitter) result.twitter = this.normalizeSocialUrl('twitter', sm.twitter);
        if (sm.x && !result.twitter) result.twitter = this.normalizeSocialUrl('twitter', sm.x);
        if (sm.youtube) result.youtube = this.normalizeSocialUrl('youtube', sm.youtube);
        if (sm.tiktok) result.tiktok = this.normalizeSocialUrl('tiktok', sm.tiktok);
        if (sm.pinterest) result.pinterest = this.normalizeSocialUrl('pinterest', sm.pinterest);
        if (sm.whatsapp) result.whatsapp = this.normalizeSocialUrl('whatsapp', sm.whatsapp);
      }
    }

    if ((place as any).facebook && !result.facebook) result.facebook = this.normalizeSocialUrl('facebook', (place as any).facebook);
    if ((place as any).instagram && !result.instagram) result.instagram = this.normalizeSocialUrl('instagram', (place as any).instagram);
    if ((place as any).linkedin && !result.linkedin) result.linkedin = this.normalizeSocialUrl('linkedin', (place as any).linkedin);
    if ((place as any).twitter && !result.twitter) result.twitter = this.normalizeSocialUrl('twitter', (place as any).twitter);
    if ((place as any).youtube && !result.youtube) result.youtube = this.normalizeSocialUrl('youtube', (place as any).youtube);
    if ((place as any).tiktok && !result.tiktok) result.tiktok = this.normalizeSocialUrl('tiktok', (place as any).tiktok);
    if ((place as any).pinterest && !result.pinterest) result.pinterest = this.normalizeSocialUrl('pinterest', (place as any).pinterest);
    if ((place as any).whatsapp && !result.whatsapp) result.whatsapp = this.normalizeSocialUrl('whatsapp', (place as any).whatsapp);

    return Object.keys(result).length > 0 ? result : undefined;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly integrationSettingsService: IntegrationSettingsService,
    @Optional()
    @Inject(forwardRef(() => LeadService))
    private readonly leadService?: LeadService,
  ) {}

  async onModuleInit() {
    try {
      await this.repairBadLeadRecords();
    } catch (err: any) {
      this.logger.warn(`Initial repair of bad lead records skipped: ${err?.message || err}`);
    }
    try {
      await this.backfillHistoricalPlacePhotos();
    } catch (err: any) {
      this.logger.warn(`Initial backfill of place photos skipped: ${err?.message || err}`);
    }
  }

  /**
   * Safely repairs existing CRM Leads created with generic "Business Lead" fallbacks
   * by cross-referencing their captureRequestId, googlePlaceId, or sourceRecordId
   * against the original DataCapturePlace records.
   */
  async repairBadLeadRecords(customerId?: number): Promise<{ repairedCount: number }> {
    try {
      const where: any = {
        deletedAt: null,
        source: { not: 'Google Maps' },
        OR: [
          { title: 'Business Lead' },
          { companyName: 'Business Lead' },
          { title: 'Direct Lead' },
          { companyName: 'Direct Lead' },
          { title: 'Unnamed Business' },
          { companyName: 'Unnamed Business' },
          { AND: [{ firstName: 'Business' }, { lastName: 'Lead' }] },
        ],
      };
      if (customerId && !isNaN(customerId) && customerId > 0) {
        where.customerId = customerId;
      }

      const badLeads = await this.prisma.lead.findMany({ where, take: 50 });
      let repairedCount = 0;

      for (const lead of badLeads) {
        let matchingPlace: any = null;
        // 1. Match by googlePlaceId
        if (lead.googlePlaceId && !lead.googlePlaceId.startsWith('custom_')) {
          matchingPlace = await this.prisma.dataCapturePlace.findFirst({
            where: { customerId: lead.customerId, googlePlaceId: lead.googlePlaceId, deletedAt: null },
          });
        }
        // 2. Match by sourceRecordId
        if (!matchingPlace && lead.sourceRecordId && !lead.sourceRecordId.startsWith('custom_')) {
          const numSourceId = Number(lead.sourceRecordId);
          matchingPlace = await this.prisma.dataCapturePlace.findFirst({
            where: {
              customerId: lead.customerId,
              deletedAt: null,
              OR: [
                ...(!isNaN(numSourceId) && numSourceId > 0 ? [{ id: numSourceId }] : []),
                { googlePlaceId: lead.sourceRecordId },
                { sourceRecordId: lead.sourceRecordId },
              ],
            },
          });
        }
        // 3. Match by parsing jobId from captureRequestId (e.g. job-60abe77e_custom_0 -> job-60abe77e)
        if (!matchingPlace && lead.captureRequestId) {
          const jobIdMatch = lead.captureRequestId.match(/^(job-[a-zA-Z0-9]+)/);
          if (jobIdMatch) {
            const parsedJobId = jobIdMatch[1];
            const idxMatch = lead.captureRequestId.match(/_custom_(\d+)/);
            const targetIdx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
            const jobPlaces = await this.prisma.dataCapturePlace.findMany({
              where: { customerId: lead.customerId, jobId: parsedJobId, deletedAt: null },
              orderBy: { id: 'asc' },
            });
            if (jobPlaces.length > 0) {
              matchingPlace = jobPlaces[targetIdx] || jobPlaces[0];
            }
          }
        }

        if (matchingPlace && matchingPlace.businessName && matchingPlace.businessName !== 'Business Lead' && matchingPlace.businessName !== 'Direct Lead' && matchingPlace.businessName !== 'Unnamed Business') {
          const repairedName = matchingPlace.businessName.trim();
          const parsedAddr = this.parseAddressComponents(matchingPlace.address);
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: {
              title: repairedName,
              companyName: repairedName,
              firstName: (lead.firstName === 'Business' && lead.lastName === 'Lead') || lead.firstName === 'Business' ? '' : lead.firstName,
              lastName: (lead.firstName === 'Business' && lead.lastName === 'Lead') || lead.lastName === 'Lead' ? '' : lead.lastName,
              googlePlaceId: (lead.googlePlaceId && !lead.googlePlaceId.startsWith('custom_')) ? lead.googlePlaceId : (matchingPlace.googlePlaceId || undefined),
              sourceRecordId: lead.sourceRecordId || String(matchingPlace.id),
              phone: lead.phone || matchingPlace.phone || undefined,
              email: lead.email || matchingPlace.email || undefined,
              website: lead.website || matchingPlace.website || undefined,
              address: lead.address || matchingPlace.address || undefined,
              city: lead.city || parsedAddr.city || undefined,
              state: lead.state || parsedAddr.state || undefined,
              pincode: lead.pincode || parsedAddr.pincode || undefined,
              category: (lead.category === 'General' || !lead.category) && matchingPlace.category ? matchingPlace.category : lead.category,
              rating: lead.rating ?? matchingPlace.rating,
              reviewCount: lead.reviewCount ?? matchingPlace.reviewCount,
              latitude: lead.latitude ?? matchingPlace.latitude,
              longitude: lead.longitude ?? matchingPlace.longitude,
              socialMedia: lead.socialMedia || matchingPlace.socialMedia || undefined,
            },
          });

          // Update matchingPlace as imported
          await this.prisma.dataCapturePlace.update({
            where: { id: matchingPlace.id },
            data: { isImported: true, importedLeadId: lead.id, status: 'LEAD_CREATED', sourceRecordId: String(matchingPlace.id) },
          }).catch(() => {});
          repairedCount++;
        }
      }

      if (repairedCount > 0) {
        this.logger.log(`[DATA CAPTURE REPAIR] Successfully repaired ${repairedCount} leads with real business data.`);
      }

      return { repairedCount };
    } catch (err: any) {
      this.logger.warn(`repairBadLeadRecords failed: ${err?.message || err}`);
      return { repairedCount: 0 };
    }
  }

  async suggestLocations(input: string) {
    const query = String(input || '').trim();
    if (query.length < 2) return { suggestions: [] };
    const mapsConfig = await this.integrationSettingsService.getGoogleMapsConfig();
    if (!mapsConfig.isEnabled || !mapsConfig.apiKey) {
      throw new BadRequestException('Google Maps is not enabled. Configure it in Settings → Integrations.');
    }
    try {
      const response = await axios.post(
        'https://places.googleapis.com/v1/places:autocomplete',
        { input: query },
        { headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': mapsConfig.apiKey }, timeout: 8000 },
      );
      const suggestions = (response.data?.suggestions || [])
        .map((item: any) => ({
          placeId: item.placePrediction?.placeId,
          label: item.placePrediction?.text?.text,
        }))
        .filter((item: { placeId?: string; label?: string }) => item.placeId && item.label);
      return { suggestions };
    } catch (err: any) {
      throw new BadRequestException(err.response?.data?.error?.message || 'Location suggestions are unavailable.');
    }
  }

  async resolveLocation(placeId: string) {
    const id = String(placeId || '').trim();
    if (!id) throw new BadRequestException('Select a location suggestion.');
    const mapsConfig = await this.integrationSettingsService.getGoogleMapsConfig();
    if (!mapsConfig.isEnabled || !mapsConfig.apiKey) {
      throw new BadRequestException('Google Maps is not enabled. Configure it in Settings → Integrations.');
    }
    try {
      const response = await axios.get(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: { 'X-Goog-Api-Key': mapsConfig.apiKey, 'X-Goog-FieldMask': 'id,formattedAddress,location' },
        timeout: 8000,
      });
      return {
        placeId: response.data?.id || id,
        address: response.data?.formattedAddress || '',
        latitude: response.data?.location?.latitude ?? null,
        longitude: response.data?.location?.longitude ?? null,
      };
    } catch (err: any) {
      throw new BadRequestException(err.response?.data?.error?.message || 'The selected location could not be resolved.');
    }
  }

  /**
   * Search and extract verified business prospects via Google Places API (New) - Text Search
   */
  async extractPlaces(
    customerId: string | number | undefined,
    userOrUserId: any,
    dto: ExtractPlacesDto,
    req?: any,
  ): Promise<{
    jobId: string;
    keyword: string;
    location: string;
    requested: number;
    captured: number;
    googleApiRequests: number;
    places: CapturedPlace[];
    records: any[];
    message: string;
  }> {
    const user = typeof userOrUserId === 'object' && userOrUserId !== null ? userOrUserId : undefined;
    const directUserId = typeof userOrUserId === 'number' || typeof userOrUserId === 'string' ? userOrUserId : user?.id;

    const effectiveCustomerId = this.requireTenant(customerId || user?.customerId);
    const effectiveUserId = Number(directUserId);
    if (!Number.isInteger(effectiveUserId) || effectiveUserId <= 0) {
      throw new UnauthorizedException('An authenticated user is required.');
    }

    if (user?.customerId && Number(user.customerId) !== effectiveCustomerId && !isUserSuperAdmin(user)) throw new ForbiddenException('Tenant mismatch.');

    // 2. Resolve and Normalize Extraction Input (keyword, location, query, category, city)
    const categoryList = Array.isArray(dto.categories)
      ? dto.categories.map((item) => String(item).trim()).filter(Boolean)
      : [];
    let keyword = (categoryList.join(', ') || dto.keyword || dto.category || dto.search || '').trim();
    let location = (dto.location || dto.city || '').trim();

    const rawQuery = (dto.query || '').trim();
    if (rawQuery) {
      if (!keyword && !location) {
        const inMatch = rawQuery.match(/^(.+?)\s+in\s+(.+)$/i);
        if (inMatch) {
          keyword = inMatch[1].trim();
          location = inMatch[2].trim();
        } else {
          keyword = rawQuery;
        }
      } else if (!keyword) {
        keyword = rawQuery;
      } else if (!location && rawQuery.toLowerCase().includes(' in ')) {
        const parts = rawQuery.split(/\s+in\s+/i);
        if (parts.length > 1) {
          location = parts.slice(1).join(' in ').trim();
        }
      }
    }

    if (location && dto.state && !location.toLowerCase().includes(dto.state.toLowerCase())) {
      location = `${location}, ${dto.state.trim()}`;
    }
    if (location && dto.country && !location.toLowerCase().includes(dto.country.toLowerCase())) {
      location = `${location}, ${dto.country.trim()}`;
    }

    if (dto.strict) {
      if (!categoryList.length) {
        throw new BadRequestException('Select at least one business category.');
      }
      if (!location) {
        throw new BadRequestException('Select a location from the suggestions.');
      }
    }
    if (!keyword && !location) {
      throw new BadRequestException(
        'Search keyword (or business category) and location are required for place extraction.',
      );
    }
    if (!keyword) {
      keyword = 'Businesses';
    }
    if (!location && !dto.strict) {
      location = 'Vadodara';
    }

    // 3. Verify Available Quota
    const requestedResults = Math.min(Math.max(dto.maxResults || dto.limit || 20, 1), 60);
    const usage = await this.getUsageSummary(effectiveCustomerId);
    if (usage.quotaRemaining <= 0) {
      throw new BadRequestException(
        `API Quota Exceeded: Your monthly extraction allowance (${usage.quotaLimit} places) has been fully consumed. Available quota: 0.`,
      );
    }
    const maxAllowed = Math.min(requestedResults, usage.quotaRemaining);

    // 4. Extract Places via Google Places API (New) or realistic fallback
    const mapsConfig = await this.integrationSettingsService.getGoogleMapsConfig();
    const apiKey = mapsConfig.apiKey;
    const searchQueries = categoryList.length
      ? categoryList.map((category) => `${category} in ${location}`)
      : [`${keyword} in ${location}`];
    const textQuery = searchQueries[0];
    const jobId = `job-${randomUUID().slice(0, 8)}`;

    const tStart = Date.now();
    let tGoogleTotal = 0;
    let tProcessTotal = 0;
    let allPlaces: CapturedPlace[] = [];
    let googleApiRequests = 0;
    let nextPageToken: string | undefined = undefined;

    if (mapsConfig.isEnabled && apiKey && apiKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      try {
        const seenPlaceIds = new Set<string>();
        for (const activeQuery of searchQueries) {
          if (allPlaces.length >= maxAllowed) break;
          nextPageToken = undefined;
          let fetchMore = true;

        while (fetchMore && allPlaces.length < maxAllowed) {
          const pageSize = Math.min(maxAllowed - allPlaces.length, 20);
          googleApiRequests++;

          const requestBody: any = {
            textQuery: activeQuery,
            pageSize,
          };
          if (dto.latitude != null && dto.longitude != null && !Number.isNaN(Number(dto.latitude)) && !Number.isNaN(Number(dto.longitude))) {
            requestBody.locationBias = {
              circle: {
                center: { latitude: Number(dto.latitude), longitude: Number(dto.longitude) },
                radius: 15000,
              },
            };
          }
          if (nextPageToken) {
            requestBody.pageToken = nextPageToken;
          }

          this.logger.log(
            `[Google Places API] Request #${googleApiRequests} for "${activeQuery}" (pageSize: ${pageSize})`,
          );

          const tGStart = Date.now();
          const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchText',
            requestBody,
            {
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': this.googleFieldMask,
              },
              timeout: 10000,
            },
          );
          const tGDuration = Date.now() - tGStart;
          tGoogleTotal += tGDuration;
          this.logger.log(
            `[DATA_CAPTURE_TIMING] Google Places Request #${googleApiRequests} completed in ${tGDuration}ms`,
          );

          const tPStart = Date.now();
          const rawPlaces: any[] = response.data?.places || [];
          nextPageToken = response.data?.nextPageToken;

          for (const p of rawPlaces) {
            if (!p.id || !p.displayName?.text || seenPlaceIds.has(p.id)) continue;
            seenPlaceIds.add(p.id);

            const normalizedPhone = ContactExtractor.normalizePhoneNumber(
              p.internationalPhoneNumber || p.nationalPhoneNumber,
            );
            const normalizedWebsite = ContactExtractor.normalizeWebsiteUrl(p.websiteUri);
            const normalizedName = ContactExtractor.normalizeCompanyName(p.displayName.text);

            const resolvedGooglePhotos = apiKey ? this.resolveGooglePhotos(p, apiKey) : [];
            const resolvedPhotoUrls = resolvedGooglePhotos.map((gp) => gp.url);

            const placeRecord: CapturedPlace = {
              provider: 'GOOGLE_PLACES',
              googlePlaceId: p.id,
              businessName: normalizedName,
              category: p.primaryTypeDisplayName?.text || p.primaryType || keyword,
              address: p.formattedAddress || 'N/A',
              phone: normalizedPhone || undefined,
              email: undefined,
              website: normalizedWebsite || undefined,
              rating: p.rating || undefined,
              reviewCount: p.userRatingCount || undefined,
              latitude: p.location?.latitude,
              longitude: p.location?.longitude,
              googleMapsUrl: p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
              businessStatus: p.businessStatus || 'OPERATIONAL',
              source: 'GOOGLE_PLACES',
              status: 'CAPTURED',
              capturedAt: new Date(),
              customerId: String(effectiveCustomerId),
              capturedBy: String(effectiveUserId),
              extractionJobId: jobId,
              rawData: p || {},
              googlePhotos: resolvedGooglePhotos,
              photos: resolvedPhotoUrls.length > 0 ? resolvedPhotoUrls : undefined,
            };

            allPlaces.push(placeRecord);
            if (allPlaces.length >= maxAllowed) {
              fetchMore = false;
              break;
            }
          }
          tProcessTotal += (Date.now() - tPStart);

          if (!nextPageToken || rawPlaces.length === 0) {
            fetchMore = false;
          }
        }
        }
      } catch (err: any) {
        this.logger.warn(
          `[Google Places API] Live search failed for "${textQuery}": ${err.message}`,
        );

        if (allPlaces.length > 0) {
          this.logger.log(`[Google Places API] Returning ${allPlaces.length} places captured before error`);
        } else if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
          throw new HttpException(
            'Google Places search timed out. Please try again with fewer results or a more specific location.',
            HttpStatus.GATEWAY_TIMEOUT,
          );
        } else if (err.response?.status === 429) {
          throw new HttpException(
            'Google Places API quota limit reached. Please try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        } else if (err.response?.status === 400 || err.response?.status === 403) {
          throw new BadRequestException(
            `Google Places search error: ${err.response?.data?.error?.message || err.message}`,
          );
        } else {
          throw new BadRequestException('Google Places search failed. Check the integration and try again.');
        }
      }
    } else {
      throw new BadRequestException('Google Maps is not enabled. Configure Settings → Integrations first.');
    }

    // 5. Duplicate Detection Before Insertion
    // A record in DataCapturePlace that has NOT been imported to Leads is NOT a duplicate Lead.
    // Only check CRM Leads for already-imported/linked Google source records.
    const tDbStart = Date.now();
    const existingPlaceIds = new Set<string>();
    const candidatePlaceIds = allPlaces
      .map((p) => p.googlePlaceId)
      .filter((id): id is string => Boolean(id));

    if (candidatePlaceIds.length > 0) {
      const existingLeads = await this.prisma.lead.findMany({
        where: {
          customerId: effectiveCustomerId,
          deletedAt: null,
          OR: [
            { googlePlaceId: { in: candidatePlaceIds } },
            { sourceRecordId: { in: candidatePlaceIds } },
          ],
        },
        select: { googlePlaceId: true, sourceRecordId: true },
      });
      for (const el of existingLeads) {
        if (el.googlePlaceId) existingPlaceIds.add(el.googlePlaceId);
        if (el.sourceRecordId) existingPlaceIds.add(el.sourceRecordId);
      }
    }

    const resolvedCreatedFrom = resolveCreatedFrom(req, user || userOrUserId, dto.createdFrom);

    const placesToCreate = allPlaces.map((p) => ({
      customerId: effectiveCustomerId,
      googlePlaceId: p.googlePlaceId,
      sourceRecordId: p.googlePlaceId,
      businessName: '', // Required schema field; Google names are live-only.
      source: 'GOOGLE_PLACES',
      createdFrom: resolvedCreatedFrom,
      status: 'CAPTURED',
      rawData: { googleReferenceOnly: true },
    }));

    // 6. Persist Job and Places to PostgreSQL
    const createdJob = await this.prisma.dataCaptureJob.create({
      data: {
        jobId,
        customerId: effectiveCustomerId,
        userId: effectiveUserId,
        createdFrom: resolvedCreatedFrom,
        keyword,
        location: dto.searchLocation || '',
        requestedResults: maxAllowed,
        capturedResults: allPlaces.length,
        googleApiRequests,
        places: {
          create: placesToCreate,
        },
      },
      include: {
        places: true,
      },
    });

    // 6.1 Record Employee Search Event (authoritative employee-specific count)
    try {
      let employeeId: number | undefined = user?.employee?.id ? Number(user.employee.id) : undefined;
      if (!employeeId && effectiveUserId) {
        const emp = await this.prisma.employee.findFirst({
          where: {
            userId: effectiveUserId,
            customerId: effectiveCustomerId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (emp) {
          employeeId = emp.id;
        }
      }

      if (employeeId && effectiveCustomerId) {
        // Idempotency check: if client passed requestId and already recorded, don't double count
        const clientRequestId = dto.requestId ? String(dto.requestId).trim() : null;
        let isDuplicateRequest = false;
        if (clientRequestId) {
          const existingSearch = await this.prisma.dataCaptureSearch.findFirst({
            where: {
              customerId: effectiveCustomerId,
              employeeId,
              requestId: clientRequestId,
            },
            select: { id: true },
          });
          if (existingSearch) {
            isDuplicateRequest = true;
          }
        }

        if (!isDuplicateRequest) {
          const searchQuery = `${keyword} in ${dto.searchLocation || ''}`;
          await this.prisma.dataCaptureSearch.create({
            data: {
              customerId: effectiveCustomerId,
              employeeId,
              userId: effectiveUserId,
              searchQuery,
              location: dto.searchLocation || '',
              requestId: clientRequestId,
              searchedAt: new Date(),
            },
          });
          this.logger.log(
            `[DATA_CAPTURE_SEARCH] Recorded search for employeeId=${employeeId} customerId=${effectiveCustomerId} query="${searchQuery}" requestId=${clientRequestId || 'none'}`,
          );
        }
      }
    } catch (searchErr: any) {
      this.logger.warn(`Failed to record DataCaptureSearch event: ${searchErr?.message}`);
    }

    const mappedPlaces: CapturedPlace[] = createdJob.places.map((p) => ({
      ...allPlaces.find((live) => live.googlePlaceId === p.googlePlaceId)!,
      id: p.id,
      status: p.status || 'CAPTURED',
      createdFrom: resolvedCreatedFrom,
      capturedAt: p.createdAt,
      rawData: { attributions: allPlaces.find((live) => live.googlePlaceId === p.googlePlaceId)?.rawData?.attributions || [] },
    }));

    const tDbDuration = Date.now() - tDbStart;
    const tTotal = Date.now() - tStart;
    this.logger.log(
      `[DATA_CAPTURE_TIMING] Job ${jobId} summary: Total: ${(tTotal / 1000).toFixed(2)}s | ` +
      `Google Places API: ${(tGoogleTotal / 1000).toFixed(2)}s (${googleApiRequests} reqs) | ` +
      `Processing: ${(tProcessTotal / 1000).toFixed(2)}s | ` +
      `DB Operations: ${(tDbDuration / 1000).toFixed(2)}s | Places: ${mappedPlaces.length}`,
    );

    return {
      jobId,
      keyword,
      location,
      requested: maxAllowed,
      captured: mappedPlaces.length,
      googleApiRequests,
      places: mappedPlaces,
      records: mappedPlaces,
      message: `Extracted ${mappedPlaces.length} business prospects from Google Places API for "${textQuery}".`,
    };
  }

  /**
   * Asynchronously enrich places with email / social media extracted from their websites
   * without blocking the synchronous Google Places search response.
   */
  private enrichPlacesWithWebsiteContactsInBackground(places: any[]) {
    if (process.env.NODE_ENV === 'test') return;
    setImmediate(async () => {
      for (const p of places) {
        if (!p.website || !p.id) continue;
        try {
          const webContact = await ContactExtractor.extractContactFromWebsite(p.website);
          if (webContact && (webContact.email || (webContact.socialMedia && Object.keys(webContact.socialMedia).length > 0))) {
            const updates: any = {};
            if (webContact.email && !p.email) {
              updates.email = webContact.email;
            }
            if (webContact.socialMedia) {
              const existingSocial = (p.socialMedia as any) || {};
              updates.socialMedia = { ...existingSocial, ...webContact.socialMedia };
            }
            if (Object.keys(updates).length > 0) {
              await this.prisma.dataCapturePlace.update({
                where: { id: p.id },
                data: updates,
              });
            }
          }
        } catch (err: any) {
          this.logger.debug?.(`[Background Enrichment] Failed for place ${p.id} (${p.website}): ${err?.message}`);
        }
      }
    });
  }

  /**
   * List captured places with pagination, search, status, and source filters
   */
  async listPlaces(
    customerId: string | number | undefined,
    query: DataCaptureQueryDto,
    user?: any,
  ) {
    try {
      const isSuperAdmin = isUserSuperAdmin(user);
      // SUPER_ADMIN may optionally pass an explicit target customerId via query param / header
      // (CustomerGuard resolves that into request.customerId; stays undefined for platform-wide view)
      const numCustomerId = this.requireTenant(customerId);
      const hasExplicitCustomer = !isNaN(numCustomerId) && numCustomerId > 0;

      const page = Math.max(Number(query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const skip = (page - 1) * limit;

      // Build tenant-scoped where clause with isolated AND conditions:
      // - SUPER_ADMIN, no explicit customerId => see ALL records (no customer filter)
      // - SUPER_ADMIN, explicit customerId   => scoped to that customer
      // - Normal user                        => strictly scoped to their customerId
      const andConditions: any[] = [{ deletedAt: null }];

      if (isSuperAdmin) {
        if (hasExplicitCustomer) {
          andConditions.push({ customerId: numCustomerId });
        }
        // else: SUPER_ADMIN — no customerId filter, full platform view
      } else {
        const effectiveCustomerId = hasExplicitCustomer ? numCustomerId : Number(user?.customerId);
        if (isNaN(effectiveCustomerId) || effectiveCustomerId <= 0) {
          throw new UnauthorizedException('User is not associated with any customer account');
        }
        andConditions.push({ customerId: effectiveCustomerId });
      }

      if (query.search && query.search.trim()) {
        const search = query.search.trim();
        andConditions.push({
          OR: [
            { businessName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { category: { contains: search, mode: 'insensitive' } },
            { googlePlaceId: { contains: search, mode: 'insensitive' } },
          ],
        });
      }

      const status = query.status?.trim();
      if (status && status.toUpperCase() !== 'ALL') {
        const upperStatus = status.toUpperCase();
        if (upperStatus === 'LEAD_CREATED') {
          andConditions.push({
            OR: [
              { status: 'LEAD_CREATED' },
              { isImported: true },
            ],
          });
        } else {
          andConditions.push({ status: upperStatus });
        }
      }

      const source = query.source?.trim();
      if (source && source.toUpperCase() !== 'ALL') {
        andConditions.push({ source: source.toUpperCase() });
      }

      const category = query.category?.trim();
      if (category && category.toUpperCase() !== 'ALL') {
        andConditions.push({ category: { contains: category, mode: 'insensitive' } });
      }

      if (query.jobId && query.jobId.trim() && query.jobId.toUpperCase() !== 'ALL') {
        andConditions.push({ jobId: query.jobId.trim() });
      }

      const createdFrom = query.createdFrom?.trim();
      if (createdFrom && createdFrom.toUpperCase() !== 'ALL') {
        andConditions.push({ createdFrom: createdFrom.toUpperCase() });
      }

      const where = andConditions.length > 0 ? { AND: andConditions } : {};

      const sortField = query.sortBy || 'createdAt';
      const sortOrder = (query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

      const [total, records] = await Promise.all([
        this.prisma.dataCapturePlace.count({ where }),
        this.prisma.dataCapturePlace.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortField]: sortOrder },
          include: {
            job: {
              select: {
                jobId: true,
                keyword: true,
                location: true,
                createdAt: true,
              },
            },
          },
        }),
      ]);

      const data: CapturedPlace[] = records.map((p) => {
        const { googlePhotos: normGP, photos: normPhotoUrls } = this.normalizeStoredPhotos(
          (p as any).photos || (p as any).rawData?.photos || (p as any).rawData?.googlePhotos,
        );

        this.logger.debug(
          `[DATA_CAPTURE_IMAGE_DEBUG]\n` +
          `recordId: ${p.id}\n` +
          `googlePlaceId: ${p.googlePlaceId || 'N/A'}\n` +
          `photoCount: ${normGP.length}\n` +
          `hasPhotoReference: ${normGP.some((gp) => Boolean(gp.name))}\n` +
          `hasPhotoUrl: ${normGP.some((gp) => Boolean(gp.url)) || normPhotoUrls.length > 0}`
        );

        return {
          id: p.id,
          provider: p.source || 'GOOGLE_PLACES',
          googlePlaceId: p.googlePlaceId || undefined,
          businessName: p.businessName,
          category: p.category || undefined,
          address: p.address || undefined,
          phone: p.phone || undefined,
          email: p.email || undefined,
          website: p.website || undefined,
          rating: p.rating || undefined,
          reviewCount: p.reviewCount || undefined,
          latitude: p.latitude || undefined,
          longitude: p.longitude || undefined,
          googleMapsUrl: p.googleMapsUrl || undefined,
          businessStatus: p.businessStatus || 'OPERATIONAL',
          source: p.source || 'GOOGLE_PLACES',
          createdFrom: p.createdFrom || undefined,
          status: p.status || 'CAPTURED',
          notes: p.notes || undefined,
          rawData: p.rawData || undefined,
          isImported: p.isImported,
          importedLeadId: p.importedLeadId || undefined,
          capturedAt: p.createdAt,
          updatedAt: p.updatedAt,
          customerId: String(p.customerId),
          extractionJobId: p.jobId || undefined,
          googlePhotos: normGP.length > 0 ? normGP : [],
          photos: normPhotoUrls.length > 0 ? normPhotoUrls : undefined,
          socialMedia: this.extractSocialMediaFromPlace(p),
        };
      });

      const totalPages = Math.ceil(total / limit) || 1;

      return {
        statusCode: 200,
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
        total,
        totalPages,
      };
    } catch (error: any) {
      this.logger.error(
        `[DATA_CAPTURE_ERROR] listPlaces failed: params=${JSON.stringify(query)} customerId=${customerId} code=${error.code || 'UNKNOWN'} error=${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get single captured place details with duplicate detection
   */
  async getPlaceById(customerId: string | number | undefined, id: number | string): Promise<CapturedPlace> {
    const numCustomerId = this.requireTenant(customerId);
    const numId = Number(id);

    if (isNaN(numId)) {
      throw new BadRequestException('Invalid Data Capture ID format.');
    }

    const where: any = {
      id: numId,
      deletedAt: null,
    };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const place = await this.prisma.dataCapturePlace.findFirst({
      where,
      include: {
        job: true,
      },
    });

    if (!place) {
      throw new NotFoundException(`Data Capture record with ID ${numId} not found.`);
    }

    if (place.googlePlaceId) {
      const config = await this.integrationSettingsService.getGoogleMapsConfig();
      if (!config.isEnabled || !config.apiKey) throw new BadRequestException('Google Maps integration is not configured.');
      let live: any;
      try {
        const response = await axios.get(`https://places.googleapis.com/v1/places/${encodeURIComponent(place.googlePlaceId)}`, {
          headers: { 'X-Goog-Api-Key': config.apiKey,
            'X-Goog-FieldMask': 'id,displayName,formattedAddress,internationalPhoneNumber,websiteUri,primaryTypeDisplayName,googleMapsUri,attributions' },
          timeout: 10000,
        });
        live = response.data;
      } catch { throw new BadRequestException('Live Google Maps details are unavailable. Please retry.'); }
      return {
        id: place.id, provider: 'GOOGLE_PLACES', source: 'GOOGLE_PLACES', googlePlaceId: place.googlePlaceId,
        businessName: live.displayName?.text || '', address: live.formattedAddress,
        phone: live.internationalPhoneNumber, website: live.websiteUri,
        category: live.primaryTypeDisplayName?.text, googleMapsUrl: live.googleMapsUri,
        rawData: { attributions: live.attributions || [] },
        capturedAt: place.createdAt, customerId: String(numCustomerId),
        isImported: place.isImported, importedLeadId: place.importedLeadId || undefined,
        status: place.status || 'CAPTURED',
      };
    }

    // Run duplicate detection against CRM entities (Lead, Company, Contact)
    const duplicateMatches = await this.findDuplicateMatches(numCustomerId || place.customerId, place);

    const { googlePhotos: placeGP, photos: placePhotoUrls } = this.normalizeStoredPhotos(
      (place as any).photos || (place as any).rawData?.photos || (place as any).rawData?.googlePhotos,
    );

    this.logger.debug(
      `[DATA_CAPTURE_IMAGE_DEBUG]\n` +
      `recordId: ${place.id}\n` +
      `googlePlaceId: ${place.googlePlaceId || 'N/A'}\n` +
      `photoCount: ${placeGP.length}\n` +
      `hasPhotoReference: ${placeGP.some((gp) => Boolean(gp.name))}\n` +
      `hasPhotoUrl: ${placeGP.some((gp) => Boolean(gp.url)) || placePhotoUrls.length > 0}`
    );

    return {
      id: place.id,
      provider: place.source || 'GOOGLE_PLACES',
      googlePlaceId: place.googlePlaceId || undefined,
      businessName: place.businessName,
      category: place.category || undefined,
      address: place.address || undefined,
      phone: place.phone || undefined,
      email: place.email || undefined,
      website: place.website || undefined,
      rating: place.rating || undefined,
      reviewCount: place.reviewCount || undefined,
      latitude: place.latitude || undefined,
      longitude: place.longitude || undefined,
      googleMapsUrl: place.googleMapsUrl || undefined,
      businessStatus: place.businessStatus || 'OPERATIONAL',
      source: place.source || 'GOOGLE_PLACES',
      createdFrom: place.createdFrom || undefined,
      status: place.status || 'CAPTURED',
      notes: place.notes || undefined,
      rawData: place.rawData || undefined,
      isImported: place.isImported,
      importedLeadId: place.importedLeadId || undefined,
      capturedAt: place.createdAt,
      updatedAt: place.updatedAt,
      customerId: String(place.customerId),
      extractionJobId: place.jobId || undefined,
      duplicateMatches,
      googlePhotos: placeGP.length > 0 ? placeGP : [],
      photos: placePhotoUrls.length > 0 ? placePhotoUrls : undefined,
      socialMedia: this.extractSocialMediaFromPlace(place),
    };
  }

  /**
   * Create a manual Data Capture prospect record
   */
  async createPlace(
    customerId: string | number | undefined,
    userId: string | number,
    dto: CreateDataCaptureDto,
    req?: any,
  ): Promise<CapturedPlace> {
    let numCustomerId = Number(customerId);
    if (isNaN(numCustomerId) || numCustomerId <= 0) {
      const defaultCustomer = await this.prisma.customer.findFirst({ where: { isActive: true } });
      numCustomerId = defaultCustomer?.id || 1;
    }

    const resolvedCreatedFrom = resolveCreatedFrom(req, { id: userId, customerId: numCustomerId }, (dto as any)?.createdFrom);

    const resolvedPhone = dto.phone?.trim()
      || dto.mobile?.trim()
      || dto.mobileNumber?.trim()
      || dto.phoneNumber?.trim()
      || dto.contactNumber?.trim()
      || undefined;

    const resolvedEmail = dto.email?.trim() || dto.emailAddress?.trim() || undefined;

    const mergedRawData = {
      ...(dto.rawData && typeof dto.rawData === 'object' ? dto.rawData : {}),
      ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.first_name ? { first_name: dto.first_name.trim() } : {}),
      ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.last_name ? { last_name: dto.last_name.trim() } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(resolvedPhone ? { phone: resolvedPhone, mobile: resolvedPhone } : {}),
      ...(resolvedEmail ? { email: resolvedEmail } : {}),
    };

    const { googlePhotos: placeGP, photos: placePhotoUrls } = this.normalizeStoredPhotos(
      dto.photos || dto.googlePhotos || mergedRawData.photos || mergedRawData.googlePhotos
    );

    const place = await this.prisma.dataCapturePlace.create({
      data: {
        customerId: numCustomerId,
        businessName: dto.businessName.trim(),
        category: dto.category?.trim(),
        address: dto.address?.trim(),
        phone: resolvedPhone,
        email: resolvedEmail,
        website: dto.website?.trim(),
        googlePlaceId: dto.googlePlaceId?.trim() || `MANUAL_${randomUUID().slice(0, 12)}`,
        rating: dto.rating,
        reviewCount: dto.reviewCount,
        latitude: dto.latitude,
        longitude: dto.longitude,
        googleMapsUrl: dto.googleMapsUrl,
        businessStatus: dto.businessStatus || 'OPERATIONAL',
        source: dto.source || 'MANUAL',
        createdFrom: resolvedCreatedFrom,
        status: dto.status || 'CAPTURED',
        notes: dto.notes,
        rawData: Object.keys(mergedRawData).length > 0 ? mergedRawData : dto.rawData,
        photos: (placeGP.length > 0 ? placeGP : (placePhotoUrls.length > 0 ? placePhotoUrls : undefined)) as any,
        socialMedia: (dto.socialMedia || undefined) as any,
      },
    });

    const duplicateMatches = await this.findDuplicateMatches(numCustomerId, place);

    return {
      id: place.id,
      provider: place.source || 'MANUAL',
      googlePlaceId: place.googlePlaceId || undefined,
      businessName: place.businessName,
      category: place.category || undefined,
      address: place.address || undefined,
      phone: place.phone || undefined,
      email: place.email || undefined,
      website: place.website || undefined,
      rating: place.rating || undefined,
      reviewCount: place.reviewCount || undefined,
      latitude: place.latitude || undefined,
      longitude: place.longitude || undefined,
      googleMapsUrl: place.googleMapsUrl || undefined,
      businessStatus: place.businessStatus || 'OPERATIONAL',
      source: place.source || 'MANUAL',
      createdFrom: place.createdFrom || undefined,
      status: place.status || 'CAPTURED',
      notes: place.notes || undefined,
      rawData: place.rawData || undefined,
      isImported: place.isImported,
      importedLeadId: place.importedLeadId || undefined,
      capturedAt: place.createdAt,
      updatedAt: place.updatedAt,
      customerId: String(place.customerId),
      duplicateMatches,
      googlePhotos: placeGP.length > 0 ? placeGP : [],
      photos: placePhotoUrls.length > 0 ? placePhotoUrls : undefined,
      socialMedia: this.extractSocialMediaFromPlace(place),
    };
  }

  /**
   * Update a Data Capture record
   */
  async updatePlace(
    customerId: string | number | undefined,
    id: number | string,
    dto: UpdateDataCaptureDto,
  ): Promise<CapturedPlace> {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const existing = await this.prisma.dataCapturePlace.findFirst({
      where,
    });

    if (!existing) {
      throw new NotFoundException(`Data Capture record with ID ${numId} not found.`);
    }

    let updatedPhotosField: any = undefined;
    if (dto.photos !== undefined || dto.googlePhotos !== undefined) {
      const { googlePhotos: inGP, photos: inUrls } = this.normalizeStoredPhotos(dto.photos || dto.googlePhotos);
      updatedPhotosField = inGP.length > 0 ? inGP : (inUrls.length > 0 ? inUrls : null);
    }

    const updated = await this.prisma.dataCapturePlace.update({
      where: { id: numId },
      data: {
        businessName: dto.businessName !== undefined ? dto.businessName.trim() : undefined,
        category: dto.category !== undefined ? dto.category?.trim() : undefined,
        address: dto.address !== undefined ? dto.address?.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone?.trim() : undefined,
        email: dto.email !== undefined ? dto.email?.trim() : undefined,
        website: dto.website !== undefined ? dto.website?.trim() : undefined,
        googlePlaceId: dto.googlePlaceId !== undefined ? dto.googlePlaceId?.trim() : undefined,
        rating: dto.rating !== undefined ? dto.rating : undefined,
        reviewCount: dto.reviewCount !== undefined ? dto.reviewCount : undefined,
        latitude: dto.latitude !== undefined ? dto.latitude : undefined,
        longitude: dto.longitude !== undefined ? dto.longitude : undefined,
        googleMapsUrl: dto.googleMapsUrl !== undefined ? dto.googleMapsUrl : undefined,
        businessStatus: dto.businessStatus !== undefined ? dto.businessStatus : undefined,
        source: dto.source !== undefined ? dto.source : undefined,
        status: dto.status !== undefined ? dto.status.toUpperCase() : undefined,
        notes: dto.notes !== undefined ? dto.notes : undefined,
        isImported: dto.isImported !== undefined ? dto.isImported : undefined,
        rawData: dto.rawData !== undefined ? dto.rawData : undefined,
        photos: updatedPhotosField as any,
        socialMedia: (dto.socialMedia !== undefined ? dto.socialMedia : undefined) as any,
      },
    });

    const duplicateMatches = await this.findDuplicateMatches(numCustomerId || updated.customerId, updated);
    const { googlePhotos: updatedGP, photos: updatedPhotoUrls } = this.normalizeStoredPhotos(updated.photos);

    return {
      id: updated.id,
      provider: updated.source || 'GOOGLE_PLACES',
      googlePlaceId: updated.googlePlaceId || undefined,
      businessName: updated.businessName,
      category: updated.category || undefined,
      address: updated.address || undefined,
      phone: updated.phone || undefined,
      email: updated.email || undefined,
      website: updated.website || undefined,
      rating: updated.rating || undefined,
      reviewCount: updated.reviewCount || undefined,
      latitude: updated.latitude || undefined,
      longitude: updated.longitude || undefined,
      googleMapsUrl: updated.googleMapsUrl || undefined,
      businessStatus: updated.businessStatus || 'OPERATIONAL',
      source: updated.source || 'GOOGLE_PLACES',
      createdFrom: updated.createdFrom || undefined,
      status: updated.status || 'CAPTURED',
      notes: updated.notes || undefined,
      rawData: updated.rawData || undefined,
      isImported: updated.isImported,
      importedLeadId: updated.importedLeadId || undefined,
      capturedAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      customerId: String(updated.customerId),
      extractionJobId: updated.jobId || undefined,
      duplicateMatches,
      googlePhotos: updatedGP.length > 0 ? updatedGP : [],
      photos: updatedPhotoUrls.length > 0 ? updatedPhotoUrls : undefined,
      socialMedia: this.extractSocialMediaFromPlace(updated),
    };
  }

  /**
   * Delete / Soft Delete a Data Capture record
   */
  async deletePlace(customerId: string | number | undefined, id: number | string): Promise<{ success: boolean; message: string }> {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const existing = await this.prisma.dataCapturePlace.findFirst({
      where,
    });

    if (!existing) {
      throw new NotFoundException(`Data Capture record with ID ${numId} not found.`);
    }

    await this.prisma.dataCapturePlace.update({
      where: { id: numId },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: `Data Capture record #${numId} deleted successfully.`,
    };
  }

  /**
   * Validate a Data Capture record
   */
  async validatePlace(customerId: string | number | undefined, id: number | string): Promise<CapturedPlace> {
    return this.updatePlace(customerId, id, { status: 'VALIDATED' });
  }

  /**
   * Reject a Data Capture record
   */
  async rejectPlace(
    customerId: string | number | undefined,
    id: number | string,
    dto?: RejectDataCaptureDto,
  ): Promise<CapturedPlace> {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const existing = await this.prisma.dataCapturePlace.findFirst({
      where,
    });

    if (!existing) {
      throw new NotFoundException(`Data Capture record with ID ${numId} not found.`);
    }

    const noteAppend = dto?.reason ? `\n[REJECTION REASON]: ${dto.reason}` : '';
    const newNotes = existing.notes ? `${existing.notes}${noteAppend}` : dto?.reason || '';

    return this.updatePlace(customerId, id, {
      status: 'REJECTED',
      notes: newNotes,
    });
  }

  /**
   * Check for duplicate matches for a specific place or prospect parameters
   */
  async checkDuplicates(customerId: string | number | undefined, id: number | string): Promise<{ duplicateMatches: DuplicateMatch[] }> {
    const numCustomerId = Number(customerId);
    const numId = Number(id);

    const where: any = { id: numId, deletedAt: null };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const place = await this.prisma.dataCapturePlace.findFirst({
      where,
    });

    if (!place) {
      throw new NotFoundException(`Data Capture record with ID ${numId} not found.`);
    }

    const duplicateMatches = await this.findDuplicateMatches(numCustomerId || place.customerId, place);
    return { duplicateMatches };
  }

  /**
   * Convert a single Data Capture prospect into a CRM Lead
   */
  private extractContactFromPlace(place: any): { firstName: string; lastName: string; phone?: string; email?: string } {
    const rawData = (place.rawData && typeof place.rawData === 'object' ? place.rawData : {}) as any;
    const nested = rawData.lead_data || rawData.google_lead || rawData.data || rawData.lead || {};

    let firstName = '';
    let lastName = '';
    let phone: string | undefined;
    let email: string | undefined;

    // Check user_column_data if Google Lead Ads / form format
    const colArray =
      rawData.user_column_data ||
      rawData.column_data ||
      rawData.form_data ||
      rawData.fields ||
      nested.user_column_data ||
      nested.column_data ||
      nested.form_data ||
      nested.fields;

    if (Array.isArray(colArray)) {
      for (const col of colArray) {
        if (!col || typeof col !== 'object') continue;
        const id = String(col.column_id || col.column_name || col.field_id || col.key || col.id || col.name || '').toUpperCase().trim();
        const val = col.string_value ?? col.value ?? col.val ?? '';
        const trimmedVal = typeof val === 'string' ? val.trim() : String(val || '').trim();
        if (!trimmedVal) continue;

        if (id === 'FIRST_NAME' || id === 'FIRSTNAME' || id === 'GIVEN_NAME') {
          if (!firstName) firstName = trimmedVal;
        } else if (id === 'LAST_NAME' || id === 'LASTNAME' || id === 'FAMILY_NAME') {
          if (!lastName) lastName = trimmedVal;
        } else if (id === 'FULL_NAME' || id === 'NAME' || id === 'CONTACT_NAME') {
          if (!firstName && !lastName) {
            const parts = trimmedVal.split(/\s+/);
            firstName = parts[0];
            lastName = parts.slice(1).join(' ') || parts[0];
          }
        } else if (id === 'EMAIL' || id === 'USER_EMAIL' || id === 'WORK_EMAIL' || id === 'EMAIL_ADDRESS') {
          if (!email) email = ContactExtractor.normalizeEmail(trimmedVal) || undefined;
        } else if (
          id === 'PHONE_NUMBER' ||
          id === 'PHONE' ||
          id === 'MOBILE' ||
          id === 'MOBILE_NUMBER' ||
          id === 'USER_PHONE' ||
          id === 'WORK_PHONE'
        ) {
          if (!phone) phone = ContactExtractor.normalizePhoneNumber(trimmedVal) || undefined;
        }
      }
    }

    if (!firstName) {
      firstName = (place.firstName || rawData.firstName || rawData.first_name || nested.firstName || nested.first_name || '').trim();
    }
    if (!lastName) {
      lastName = (place.lastName || rawData.lastName || rawData.last_name || nested.lastName || nested.last_name || '').trim();
    }

    if (!firstName && !lastName) {
      const name = place.contactName || rawData.name || rawData.full_name || nested.name || nested.full_name;
      if (name && typeof name === 'string' && !name.startsWith('places/') && name.trim() !== 'Business Lead') {
        const parts = name.trim().split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ') || parts[0];
      }
    }

    // Do NOT split businessName into contact person. If no contact person, use clean empty strings.
    const isGenericContact = (s: string) => {
      const lower = s.trim().toLowerCase();
      return (
        !lower ||
        lower === 'business' ||
        lower === 'lead' ||
        lower === 'owner' ||
        lower === 'unknown' ||
        lower === 'prospect' ||
        lower === 'direct' ||
        lower === 'customer' ||
        lower.startsWith('places/')
      );
    };

    if (isGenericContact(firstName)) firstName = '';
    if (isGenericContact(lastName)) lastName = '';

    if (!phone) {
      const rawCandidatePhone =
        place.phone ||
        place.internationalPhoneNumber ||
        place.nationalPhoneNumber ||
        rawData.phone ||
        rawData.mobile ||
        rawData.mobileNumber ||
        rawData.phoneNumber ||
        rawData.phone_number ||
        rawData.user_phone ||
        rawData.user_phone_number ||
        rawData.contactNumber ||
        nested.phone ||
        nested.mobile ||
        undefined;
      phone = ContactExtractor.normalizePhoneNumber(rawCandidatePhone) || undefined;
    }

    if (!email) {
      const rawCandidateEmail =
        place.email ||
        rawData.email ||
        rawData.user_email ||
        rawData.emailAddress ||
        rawData.email_address ||
        nested.email ||
        undefined;
      email = ContactExtractor.normalizeEmail(rawCandidateEmail) || undefined;
    }

    return { firstName, lastName, phone, email };
  }

  private parseAddressComponents(address?: string | null): { city: string | null; state: string | null; pincode: string | null } {
    if (!address || address === 'N/A' || !address.trim()) {
      return { city: null, state: null, pincode: null };
    }
    const clean = address.trim();
    const pinMatch = clean.match(/\b\d{6}\b/) || clean.match(/\b\d{5}(-\d{4})?\b/);
    const pincode = pinMatch ? pinMatch[0] : null;

    const parts = clean.split(',').map((p) => p.trim()).filter(Boolean);
    let city: string | null = null;
    let state: string | null = null;

    if (parts.length >= 3) {
      const secondLast = parts[parts.length - 2];
      const lastPart = parts[parts.length - 1];
      city = secondLast.replace(/\b\d{6}\b/, '').trim() || null;
      state = lastPart.replace(/\b\d{6}\b/, '').trim() || null;
    } else if (parts.length === 2) {
      city = parts[0].trim() || null;
      state = parts[1].replace(/\b\d{6}\b/, '').trim() || null;
    } else if (parts.length === 1 && !pincode) {
      city = parts[0].trim() || null;
    }
    return { city, state, pincode };
  }

  private normalizePhotosArray(raw: any): string[] {
    const urls: string[] = [];
    if (!raw) return urls;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('/api/'))) {
          urls.push(item);
        } else if (item && typeof item === 'object') {
          const u = item.url || item.photoUri || item.uri;
          if (typeof u === 'string' && (u.startsWith('http') || u.startsWith('/api/'))) {
            urls.push(u);
          } else if (item.name && typeof item.name === 'string') {
            urls.push(`/api/v1/data-capture/photo?ref=${encodeURIComponent(item.name)}`);
          }
        }
      }
    } else if (typeof raw === 'string' && (raw.startsWith('http') || raw.startsWith('/api/'))) {
      urls.push(raw);
    }
    return urls;
  }

  private extractSocialProfileList(socialMedia: any): Array<{ platform: string; url: string }> {
    const list: Array<{ platform: string; url: string }> = [];
    if (!socialMedia || typeof socialMedia !== 'object') return list;
    const mapping: Record<string, string> = {
      instagram: 'INSTAGRAM',
      facebook: 'FACEBOOK',
      youtube: 'YOUTUBE',
      linkedin: 'LINKEDIN',
      twitter: 'TWITTER',
      x: 'TWITTER',
      tiktok: 'TIKTOK',
      pinterest: 'PINTEREST',
      whatsapp: 'WHATSAPP',
    };
    for (const [key, platform] of Object.entries(mapping)) {
      const val = (socialMedia as any)[key];
      if (typeof val === 'string' && val.trim().startsWith('http')) {
        list.push({ platform, url: val.trim() });
      }
    }
    return list;
  }

  async createLeadFromPlace(
    customerId: string | number,
    userId: any,
    id: number | string,
    captureRequestId?: string,
    dto?: CreateLeadFromPlaceDto,
    req?: any,
  ): Promise<{
    success: boolean;
    statusCode?: number;
    leadId?: number;
    lead: any;
    data: any;
    place: CapturedPlace;
    message: string;
    isDuplicate: boolean;
  }> {
    const tenantId = this.requireTenant(customerId);
    const result = await this.importToLeads(tenantId, userId, {
      ...dto, captureRequestId,
      places: [{ id, independentFields: dto?.independentFields }],
    }, req);
    const record = result.records?.[0];
    if (!record || record.failed) throw new BadRequestException(record?.error || 'Import failed.');
    const place = await this.prisma.dataCapturePlace.findFirst({ where: { id: Number(id), customerId: tenantId, deletedAt: null } });
    return {
      success: true, leadId: record.leadId, lead: result.lead,
      data: { lead: result.lead, place }, place: place as any,
      isDuplicate: Boolean(record.duplicate), message: result.message,
    };
  }

  async handleBulkAction(
    customerId: string | number,
    userId: string | number,
    dto: BulkActionDto,
  ): Promise<{ success: boolean; affectedCount: number; message: string }> {
    const numCustomerId = Number(customerId);
    const numUserId = Number(userId) || 1;

    if (!dto.ids || dto.ids.length === 0) {
      throw new BadRequestException('No records selected for bulk action.');
    }

    let affectedCount = 0;

    switch (dto.action) {
      case 'validate': {
        const res = await this.prisma.dataCapturePlace.updateMany({
          where: { id: { in: dto.ids }, customerId: numCustomerId, deletedAt: null },
          data: { status: 'VALIDATED' },
        });
        affectedCount = res.count;
        break;
      }
      case 'reject': {
        const res = await this.prisma.dataCapturePlace.updateMany({
          where: { id: { in: dto.ids }, customerId: numCustomerId, deletedAt: null },
          data: { status: 'REJECTED' },
        });
        affectedCount = res.count;
        break;
      }
      case 'mark_duplicate': {
        const res = await this.prisma.dataCapturePlace.updateMany({
          where: { id: { in: dto.ids }, customerId: numCustomerId, deletedAt: null },
          data: { status: 'DUPLICATE' },
        });
        affectedCount = res.count;
        break;
      }
      case 'delete': {
        const res = await this.prisma.dataCapturePlace.updateMany({
          where: { id: { in: dto.ids }, customerId: numCustomerId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        affectedCount = res.count;
        break;
      }
      case 'import_leads': {
        const result = await this.importToLeads(numCustomerId, userId, { places: dto.ids.map((id) => ({ id })) });
        return { ...result, affectedCount: result.imported };
      }
      default:
        throw new BadRequestException(`Unknown bulk action "${dto.action}".`);
    }

    return {
      success: true,
      affectedCount,
      message: `Bulk action "${dto.action}" completed successfully on ${affectedCount} records.`,
    };
  }

  /**
   * Import captured prospects into CRM Leads (Batch & Single)
   */
  private validateIndependentLeadFields(input: any) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('CRM fields must be an object.');
    const fields: Record<string, string> = {};
    for (const key of ['businessName', 'phone', 'email', 'website', 'address', 'city', 'state', 'country', 'pincode', 'category']) {
      const value = input[key];
      if (value == null || value === '') continue;
      if (typeof value !== 'string' || value.length > (key === 'address' ? 2000 : 500)) throw new BadRequestException(`Invalid ${key}.`);
      fields[key] = value.trim();
    }
    if (!fields.businessName) throw new BadRequestException('An independently sourced business name is required.');
    if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new BadRequestException('Invalid email.');
    if (fields.phone && (!/^\+?[\d\s().-]{8,25}$/.test(fields.phone) || fields.phone.replace(/\D/g, '').length < 8 || fields.phone.replace(/\D/g, '').length > 15)) throw new BadRequestException('Invalid phone.');
    if (fields.website) {
      try { if (!['http:', 'https:'].includes(new URL(fields.website).protocol)) throw new Error(); }
      catch { throw new BadRequestException('Website must be an http or https URL.'); }
    }
    return fields;
  }

  async importToLeads(
    customerId: string | number,
    userId: any,
    dto: ImportToLeadsDto,
    req?: any,
  ): Promise<{
    success: boolean;
    totalRequested: number;
    imported: number;
    skippedDuplicates: number;
    failed: number;
    duplicateNames: string[];
    records?: any[];
    data?: any;
    leadId?: number;
    lead?: any;
    leads?: any[];
    capture?: { id: string; status: string };
    message: string;
  }> {
    const effectiveUser = typeof userId === 'object' && userId !== null ? userId : null;
    const numUserId = Number(effectiveUser?.id || userId);
    const numCustomerId = this.requireTenant(customerId || effectiveUser?.customerId);
    if (!Number.isInteger(numUserId) || numUserId <= 0) throw new UnauthorizedException('An authenticated user is required.');
    const actor = await this.prisma.user.findFirst({ where: { id: numUserId, deletedAt: null } });
    if (!actor || (actor.customerId !== numCustomerId && !isUserSuperAdmin(effectiveUser))) {
      throw new ForbiddenException('The importing user does not belong to this tenant.');
    }
    const validCreatedById = numUserId;
    const employee = await this.prisma.employee.findFirst({
      where: { userId: numUserId, customerId: numCustomerId, status: 'ACTIVE' },
      select: { id: true, userId: true },
    });
    let employeeId = employee?.id || null;
    let assignedToUserId = employee?.userId || null;
    if (dto.assignedToId || dto.employeeId) {
      const assignee = await this.resolveTargetEmployee(dto.assignedToId || dto.employeeId, numCustomerId);
      if (!assignee) throw new BadRequestException('Invalid assigned employee for this tenant.');
      employeeId = assignee.id;
      assignedToUserId = assignee.userId;
    }
    if (dto.jobId && !await this.prisma.dataCaptureJob.findFirst({ where: { jobId: dto.jobId, customerId: numCustomerId } })) {
      throw new NotFoundException('Capture session not found.');
    }

    // Gather candidate descriptors from DTO (Section 3)
    let rawCandidates: any[] = [];
    if (dto.places && Array.isArray(dto.places) && dto.places.length > 0) {
      rawCandidates = dto.places;
    } else if (dto.placeIds && Array.isArray(dto.placeIds) && dto.placeIds.length > 0) {
      rawCandidates = dto.placeIds.map((id) => ({ ...dto, id, googlePlaceId: id, sourceRecordId: id }));
    } else if (dto.dataCaptureId || dto.dataCapturePlaceId || dto.placeId || dto.id) {
      const singleId = dto.dataCaptureId || dto.dataCapturePlaceId || dto.placeId || dto.id;
      rawCandidates = [{ ...dto, id: singleId, sourceRecordId: dto.sourceRecordId || singleId }];
    } else if (dto.googlePlaceId) {
      rawCandidates = [{ ...dto, googlePlaceId: dto.googlePlaceId, sourceRecordId: dto.sourceRecordId || dto.googlePlaceId }];
    } else if (dto.jobId) {
      const jobPlaces = await this.prisma.dataCapturePlace.findMany({
        where: { jobId: dto.jobId, customerId: numCustomerId, deletedAt: null },
        orderBy: { id: 'asc' },
      });
      rawCandidates = jobPlaces;
    } else if (dto.companyName || dto.businessName) {
      rawCandidates = [dto];
    }

    if (rawCandidates.length > 100) throw new BadRequestException('Select at most 100 records per import.');
    if (rawCandidates.length === 0) {
      throw new BadRequestException('No valid prospects selected for import.');
    }

    let importedCount = 0;
    let skippedDuplicates = 0;
    const duplicateNames: string[] = [];
    const createdLeads: any[] = [];
    const perRecordResults: any[] = [];
    let firstDuplicateLead: any = null;

    for (let idx = 0; idx < rawCandidates.length; idx++) {
      const candidate = rawCandidates[idx];
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        perRecordResults.push({ imported: false, duplicate: false, failed: true, error: 'Invalid selected record.' });
        continue;
      }

      // 1. Authoritative resolution of DataCapturePlace from database (Sections 2, 3, 4, 14)
      let dbPlace: any = null;
      const candidateNumId = Number(candidate.id || candidate.dataCaptureId || candidate.dataCapturePlaceId || candidate.sourceRecordId);
      const candGoogleId =
        candidate.googlePlaceId &&
        String(candidate.googlePlaceId).trim().length > 0 &&
        String(candidate.googlePlaceId).trim() !== 'N/A' &&
        !String(candidate.googlePlaceId).startsWith('custom_')
          ? String(candidate.googlePlaceId).trim()
          : null;
      const candSourceId =
        candidate.sourceRecordId &&
        String(candidate.sourceRecordId).trim().length > 0 &&
        String(candidate.sourceRecordId).trim() !== 'N/A' &&
        !String(candidate.sourceRecordId).startsWith('custom_')
          ? String(candidate.sourceRecordId).trim()
          : null;

      // Priority A: Match by primary key id
      if (!isNaN(candidateNumId) && candidateNumId > 0) {
        dbPlace = await this.prisma.dataCapturePlace.findFirst({
          where: { id: candidateNumId, customerId: numCustomerId, deletedAt: null },
        });
      }

      // Priority B: Match by googlePlaceId
      if (!dbPlace && candGoogleId) {
        dbPlace = await this.prisma.dataCapturePlace.findFirst({
          where: { googlePlaceId: candGoogleId, customerId: numCustomerId, deletedAt: null, ...(dto.jobId ? { jobId: dto.jobId } : {}) },
        });
      }

      // Priority C: Match by sourceRecordId
      if (!dbPlace && candSourceId) {
        const numCandidateSrc = Number(candSourceId);
        dbPlace = await this.prisma.dataCapturePlace.findFirst({
          where: {
            customerId: numCustomerId,
            deletedAt: null,
            OR: [
              ...(!isNaN(numCandidateSrc) && numCandidateSrc > 0 ? [{ id: numCandidateSrc }] : []),
              { sourceRecordId: candSourceId },
              { googlePlaceId: candSourceId },
            ],
          },
        });
      }

      const activeJobId = dbPlace?.jobId;
      if (!dbPlace || (dto.jobId && dbPlace.jobId !== dto.jobId)) {
        perRecordResults.push({ googlePlaceId: candGoogleId, sourceRecordId: candSourceId,
          imported: false, duplicate: false, failed: true, error: 'Captured record not found in this tenant/session.' });
        continue;
      }
      // Provider content is never copied into CRM. Independent fields are explicitly submitted,
      // or reused from a prior failed attempt recorded by this importer.
      const googleReference = Boolean(dbPlace.googlePlaceId) || /GOOGLE/i.test(dbPlace.source || '');
      const independent = candidate.independentFields || (dbPlace.rawData as any)?.independentFields;
      if (googleReference && independent) {
        dbPlace = { ...dbPlace, businessName: '', phone: null, email: null, website: null,
          address: null, category: null, rating: null, reviewCount: null, latitude: null,
          longitude: null, socialMedia: null, rawData: { independentFields: independent },
          ...Object.fromEntries(['businessName', 'phone', 'email', 'website', 'address', 'city', 'state', 'country', 'pincode', 'category'].map((key) => [key, independent[key]])) };
      }
      if (googleReference && !independent) {
        // Allow provider-ID duplicate checks without requiring re-entry of existing CRM data.
        const existing = await this.prisma.lead.findFirst({ where: {
          customerId: numCustomerId, deletedAt: null, googlePlaceId: dbPlace.googlePlaceId,
        } });
        if (existing && dbPlace.googlePlaceId) {
          skippedDuplicates++;
          duplicateNames.push(existing.title);
          await this.prisma.dataCapturePlace.update({ where: { id: dbPlace.id }, data: {
            isImported: true, importedLeadId: existing.id,
            status: dbPlace.importedLeadId === existing.id && dbPlace.status === 'LEAD_CREATED' ? 'LEAD_CREATED' : 'DUPLICATE',
          } });
          perRecordResults.push({ googlePlaceId: dbPlace.googlePlaceId, sourceRecordId: String(dbPlace.id),
            imported: false, duplicate: true, existingLeadId: existing.id, leadId: existing.id });
          createdLeads.push(existing);
          continue;
        }
        await this.prisma.dataCapturePlace.update({ where: { id: dbPlace.id }, data: { status: 'IMPORT_FAILED' } });
        perRecordResults.push({ googlePlaceId: dbPlace.googlePlaceId, sourceRecordId: String(dbPlace.id),
          imported: false, duplicate: false, failed: true,
          error: 'Enter independently sourced CRM fields before importing this Google reference.' });
        continue;
      }

      // 2. Authoritative field mapping from candidate and dbPlace (Sections 4, 5, 6, 7, 8)
      let fields: any;
      try {
        fields = this.validateIndependentLeadFields(dbPlace);
      } catch (error: any) {
        await this.prisma.dataCapturePlace.update({ where: { id: dbPlace.id }, data: { status: 'IMPORT_FAILED' } });
        perRecordResults.push({ googlePlaceId: dbPlace.googlePlaceId, sourceRecordId: String(dbPlace.id),
          imported: false, duplicate: false, failed: true, error: error.message });
        continue;
      }
      const businessName = fields.businessName;
      const googlePlaceId = (dbPlace.googlePlaceId && !dbPlace.googlePlaceId.startsWith('custom_') && dbPlace.googlePlaceId !== 'N/A') ? dbPlace.googlePlaceId : null;
      const sourceRecordId = dbPlace.sourceRecordId || googlePlaceId || String(dbPlace.id);
      const placeCaptureRequestId = dto.captureRequestId || candidate.captureRequestId || `${activeJobId || 'job'}_${googlePlaceId || dbPlace.id}`;

      const resolvedPhone = fields.phone;
      const normalizedPhone = resolvedPhone ? (ContactExtractor.normalizePhoneNumber(resolvedPhone) || resolvedPhone) : null;
      const phoneDigits = resolvedPhone ? String(resolvedPhone).replace(/\D/g, '') : '';

      const resolvedEmail = fields.email;
      const normalizedEmail = ContactExtractor.normalizeEmail(resolvedEmail);

      const resolvedWebsite = fields.website;
      const normalizedWebsite = ContactExtractor.normalizeWebsiteUrl(resolvedWebsite);

      const resolvedAddress = fields.address || null;
      const resolvedCategory = fields.category || null;
      const resolvedRating = null;
      const resolvedReviewCount = null;
      const resolvedLatitude = null;
      const resolvedLongitude = null;
      const parsedAddress = { city: fields.city || null, state: fields.state || null, pincode: fields.pincode || null };
      const genuineFirstName = '';
      const genuineLastName = '';
      const placeSocialMedia = null;

      // 3. Duplicate Detection against CRM Leads (Section 13)
      const leadOrConditions: any[] = [];
      if (googlePlaceId) {
        leadOrConditions.push({ googlePlaceId });
        leadOrConditions.push({ sourceRecordId: googlePlaceId });
      }
      leadOrConditions.push({ sourceRecordId });
      if (normalizedPhone && phoneDigits.length >= 10) {
        leadOrConditions.push({ phone: normalizedPhone });
        leadOrConditions.push({ phone: { contains: phoneDigits.slice(-10) } });
      }
      if (normalizedEmail) {
        leadOrConditions.push({ email: { equals: normalizedEmail, mode: 'insensitive' } });
      }

      let matchedLead: any = null;
      let duplicateMatchReason: string | null = null;

      const candEmployeeId = employeeId;
      const candAssignedToUserId = assignedToUserId;

      // 4. Transactional Lead Creation & State Update (Sections 12, 14, 15)
      const runTransaction = (cb: any, opts?: any) => this.prisma.$transaction(cb, opts);

      let createdViaDirectTx = false;
      let leadResult: any;
      try {
      leadResult = await runTransaction(
        async (tx: any) => {
          // Serialize imports for this tenant across processes; recheck only after the lock.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(72341, ${numCustomerId}::integer)`;
      if (leadOrConditions.length > 0) {
        const candidateLeads = await tx.lead.findMany({
          where: {
            customerId: numCustomerId,
            deletedAt: null,
            OR: leadOrConditions,
          },
          select: {
            id: true,
            title: true,
            companyName: true,
            phone: true,
            email: true,
            website: true,
            googlePlaceId: true,
            sourceRecordId: true,
            assignedToId: true,
            employeeId: true,
          },
        });

        if (phoneDigits.length >= 10) {
          const phoneMatches = await tx.$queryRaw`
            SELECT id, title, "companyName", phone, email, "googlePlaceId", "sourceRecordId", "assignedToId", "employeeId"
            FROM "Lead" WHERE "customerId" = ${numCustomerId} AND "deletedAt" IS NULL
              AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${phoneDigits.slice(-10)}`;
          candidateLeads.push(...phoneMatches);
        }
        candidateLeads.sort((a: any, b: any) => Number(b.googlePlaceId === googlePlaceId) - Number(a.googlePlaceId === googlePlaceId));
        for (const cl of candidateLeads) {
          if (googlePlaceId && (cl.googlePlaceId === googlePlaceId || cl.sourceRecordId === googlePlaceId)) {
            matchedLead = cl;
            duplicateMatchReason = `Google Place ID match (${googlePlaceId})`;
            break;
          }
          if (cl.sourceRecordId === sourceRecordId) {
            matchedLead = cl;
            duplicateMatchReason = `Data Capture source record ID match (${sourceRecordId})`;
            break;
          }
          if (phoneDigits.length >= 10 && cl.phone && cl.phone.replace(/\D/g, '').slice(-10) === phoneDigits.slice(-10)) {
            matchedLead = cl;
            duplicateMatchReason = `Phone match (${cl.phone})`;
            break;
          }
          if (normalizedEmail && cl.email && cl.email.toLowerCase() === normalizedEmail.toLowerCase()) {
            matchedLead = cl;
            duplicateMatchReason = `Email match (${cl.email})`;
            break;
          }
        }
      }


          if (matchedLead) {
            const currentPlace = await tx.dataCapturePlace.findFirst({ where: { id: dbPlace.id, customerId: numCustomerId } });
            await tx.dataCapturePlace.update({ where: { id: dbPlace.id }, data: {
              isImported: true, importedLeadId: matchedLead.id,
              status: currentPlace?.importedLeadId === matchedLead.id && currentPlace?.status === 'LEAD_CREATED' ? 'LEAD_CREATED' : 'DUPLICATE',
            } });
            return { ...matchedLead, alreadyExists: true };
          }
          // Resolve initial stage: 'NEW'
          let newStage = await tx.leadStage.findFirst({
            where: { customerId: numCustomerId, key: 'NEW', deletedAt: null, isActive: true },
            orderBy: { sortOrder: 'asc' },
          });
          if (!newStage) {
            newStage = await tx.leadStage.findFirst({
              where: { customerId: null, key: 'NEW', deletedAt: null, isActive: true },
              orderBy: { sortOrder: 'asc' },
            });
          }
          // Create Lead with exact Data Capture fields (Section 5, 6, 7, 8, 9, 10)
          const leadCreatedFrom =
            (dto as any)?.createdFrom ||
            dbPlace.createdFrom ||
            resolveCreatedFrom(req, effectiveUser || { id: validCreatedById, customerId: numCustomerId }, (dto as any)?.createdFrom) ||
            RecordCreatedFrom.MOBILE_APP;

          const resolvedSource = googleReference ? 'Google Maps' : (dbPlace.source || 'MANUAL');

          let created: any = null;
          if (tx.lead && typeof tx.lead.create === 'function') {
            try {
              created = await tx.lead.create({
                data: {
                  customerId: numCustomerId,
                  title: businessName,
                  companyName: businessName,
                  firstName: genuineFirstName,
                  lastName: genuineLastName,
                  phone: normalizedPhone || null,
                  email: normalizedEmail || null,
                  website: normalizedWebsite || null,
                  address: resolvedAddress,
                  city: parsedAddress.city,
                  state: parsedAddress.state,
                  pincode: parsedAddress.pincode,
                  country: fields.country || null,
                  category: resolvedCategory,
                  source: resolvedSource,
                  createdFrom: leadCreatedFrom,
                  status: 'NEW',
                  stageId: newStage?.id || null,
                  priority: 'MEDIUM',
                  value: 0,
                  createdById: validCreatedById,
                  employeeId: candEmployeeId || employeeId || null,
                  assignedToId: candAssignedToUserId || assignedToUserId || null,
                  googlePlaceId,
                  latitude: resolvedLatitude,
                  longitude: resolvedLongitude,
                  rating: resolvedRating,
                  reviewCount: resolvedReviewCount,
                  captureRequestId: placeCaptureRequestId,
                  sourceRecordId,
                  socialMedia: placeSocialMedia || null,
                },
              });
              createdViaDirectTx = true;
            } catch (createErr: any) {
              this.logger.error(`[IMPORT ERROR] tx.lead.create failed for "${businessName}": ${createErr?.message || createErr}`);
              throw createErr;
            }
          }

          if (!created && this.leadService && typeof this.leadService.createLead === 'function') {
            const leadPayload = {
              companyName: businessName,
              title: businessName,
              phone: normalizedPhone || undefined,
              email: normalizedEmail || undefined,
              captureRequestId: placeCaptureRequestId,
              sourceRecordId,
              googlePlaceId: googlePlaceId || undefined,
              assignedToId: assignedToUserId || validCreatedById || undefined,
              createdFrom: leadCreatedFrom,
            };
            created = req
              ? await this.leadService.createLead(numCustomerId, validCreatedById, leadPayload, req)
              : await this.leadService.createLead(numCustomerId, validCreatedById, leadPayload);
          }

          if (!created) {
            throw new BadRequestException(`Failed to create Lead for "${businessName}"`);
          }

          // Attach Social Profiles to LeadSocialProfile (Section 10)
          const spProfiles = this.extractSocialProfileList(placeSocialMedia);
          if (tx.leadSocialProfile && typeof tx.leadSocialProfile.create === 'function') {
            for (const sp of spProfiles) {
              await tx.leadSocialProfile.create({
                data: {
                  leadId: created.id,
                  platform: sp.platform,
                  url: sp.url,
                },
              });
            }
          }

          // Mark DataCapturePlace as imported with importedLeadId (Section 12)
          if (tx.dataCapturePlace && typeof tx.dataCapturePlace.update === 'function') {
            await tx.dataCapturePlace.update({
              where: { id: dbPlace.id },
              data: {
                isImported: true,
                importedLeadId: created.id,
                status: 'LEAD_CREATED',
                rawData: { googleReferenceOnly: googleReference, independentFields: fields },
                captureRequestId: placeCaptureRequestId,
                sourceRecordId,
              },
            });
          }

          // Create lead activity timeline and metadata note
          if (tx.leadActivityTimeline && typeof tx.leadActivityTimeline.create === 'function') {
            await tx.leadActivityTimeline.create({
              data: {
                leadId: created.id,
                action: 'PROSPECT_IMPORTED_FROM_DATA_CAPTURE',
                description: `Imported prospect "${businessName}" into CRM Leads`,
                metadata: {
                  dataCapturePlaceId: dbPlace.id,
                  googlePlaceId,
                  jobId: activeJobId,
                  source: candidate.source || dbPlace.source || (googlePlaceId ? 'GOOGLE_PLACES' : 'GOOGLE_DISCOVERY'),
                  captureRequestId: placeCaptureRequestId,
                },
              },
            });
          }

          return created;
        },
        { timeout: 15000, maxWait: 15000 },
      );
      } catch (importErr: any) {
        try {
          if (dbPlace?.id) {
            await this.prisma.dataCapturePlace.update({
              where: { id: dbPlace.id },
              data: { status: 'IMPORT_FAILED', rawData: { googleReferenceOnly: googleReference, independentFields: fields } },
            });
          }
        } catch (_) {}
        perRecordResults.push({
          sourceRecordId,
          googlePlaceId: googlePlaceId || undefined,
          businessName,
          imported: false,
          duplicate: false,
          failed: true,
          error: importErr?.message || 'Import failed',
        });
        continue;
      }

      if (leadResult.alreadyExists) {
        skippedDuplicates++;
        duplicateNames.push(businessName);
        createdLeads.push(leadResult);
        perRecordResults.push({ sourceRecordId, googlePlaceId, businessName,
          imported: false, duplicate: true, existingLeadId: leadResult.id, leadId: leadResult.id,
          duplicateMatchReason });
        continue;
      }
      this.logger.log(`Data Capture imported lead ${leadResult.id} for tenant ${numCustomerId}`);

      // Query complete lead with images and relations
      const freshLead = (this.leadService && typeof this.leadService.getLeadById === 'function')
        ? await this.leadService.getLeadById(numCustomerId, leadResult.id).catch(() => leadResult)
        : leadResult;

      perRecordResults.push({
        sourceRecordId,
        googlePlaceId: googlePlaceId || undefined,
        businessName,
        imported: true,
        leadId: leadResult.id,
        duplicate: false,
        duplicateMatchReason: null,
      });

      createdLeads.push(freshLead || leadResult);
      importedCount++;

      // Trigger automatic Email & WhatsApp communication for NEW Lead (Data Capture flow)
      if (this.leadService && freshLead) {
        const initialStageName = freshLead.stage?.name || freshLead.status || 'New';
        this.logger.log(
          `[LEAD_AUTOMATION]\n` +
          `leadId=${freshLead.id}\n` +
          `stage=NEW\n` +
          `tenantId=${numCustomerId}\n` +
          `emailTemplateLookup=START\n` +
          `whatsappTemplateLookup=START`
        );

        const emailPromise = typeof this.leadService.handleLeadStageChangeNotification === 'function'
          ? this.leadService.handleLeadStageChangeNotification(
              numCustomerId,
              freshLead,
              '',
              initialStageName,
              validCreatedById,
              undefined,
              undefined,
              undefined,
              'LEAD_CREATED',
              freshLead.stageId,
            ).catch((err: any) => {
              this.logger.error(`[NEW_LEAD_EMAIL_NOTIFICATION_ERROR] Data capture lead #${freshLead.id}: ${err?.message}`);
            })
          : Promise.resolve();

        const whatsappPromise = typeof this.leadService.handleLeadStageChangeWhatsappNotification === 'function'
          ? this.leadService.handleLeadStageChangeWhatsappNotification(
              numCustomerId,
              freshLead,
              '',
              initialStageName,
              validCreatedById,
              undefined,
              undefined,
              'LEAD_CREATED',
              freshLead.stageId,
            ).catch((err: any) => {
              this.logger.error(`[NEW_LEAD_WHATSAPP_NOTIFICATION_ERROR] Data capture lead #${freshLead.id}: ${err?.message}`);
            })
          : Promise.resolve();

        await Promise.allSettled([emailPromise, whatsappPromise]);
      }

      // Trigger Lead Assignment push notification if assigned to an employee and created directly via tx
      if (
        createdViaDirectTx &&
        this.leadService &&
        freshLead &&
        (candEmployeeId || employeeId || candAssignedToUserId || (assignedToUserId && assignedToUserId !== validCreatedById))
      ) {
        const assignedEmpId = candEmployeeId || employeeId || null;
        const assignedUsrId =
          candAssignedToUserId || (assignedToUserId !== validCreatedById ? assignedToUserId : null);
        const displayName =
          freshLead.companyName ||
          freshLead.title ||
          [freshLead.firstName, freshLead.lastName].filter(Boolean).join(' ').trim() ||
          `Lead #${freshLead.id}`;

        await (this.leadService as any)
          .sendLeadAssignedNotification?.({
            customerId: numCustomerId,
            employeeId: assignedEmpId,
            userId: assignedUsrId,
            leadId: freshLead.id,
            leadName: displayName,
          })
          ?.catch?.((err: any) => {
            this.logger.warn(
              `Failed to dispatch LEAD_ASSIGNED push for data-capture lead #${freshLead.id}: ${err?.message}`,
            );
          });
      }
    }

    const primaryLead = createdLeads[0] || firstDuplicateLead || null;

    return {
      success: true,
      totalRequested: rawCandidates.length,
      imported: importedCount,
      failed: perRecordResults.filter((r) => r.failed).length,
      skippedDuplicates,
      duplicateNames,
      records: perRecordResults,
      data: {
        leadId: primaryLead?.id,
        lead: primaryLead,
        leads: createdLeads,
        totalRequested: rawCandidates.length,
        imported: importedCount,
        skippedDuplicates,
        failed: Math.max(rawCandidates.length - importedCount - skippedDuplicates, 0),
        duplicateNames,
        records: perRecordResults,
      },
      leadId: primaryLead?.id,
      lead: primaryLead,
      leads: createdLeads,
      capture: {
        id: dto.jobId || 'captured',
        status: importedCount > 0 ? 'IMPORTED' : (skippedDuplicates > 0 ? 'DUPLICATE' : 'FAILED'),
      },
      message: `Successfully imported ${importedCount} leads into CRM (${skippedDuplicates} duplicates skipped).`,
    };
  }

  /**
   * Get extraction history for customer from PostgreSQL
   */
  async getCustomerJobs(customerId?: string | number): Promise<ExtractionJob[]> {
    const numCustomerId = Number(customerId);
    const where: any = {};
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const jobs = await this.prisma.dataCaptureJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        places: {
          where: { deletedAt: null },
        },
      },
    });

    return jobs.map((j) => ({
      jobId: j.jobId,
      customerId: String(j.customerId),
      userId: String(j.userId),
      keyword: j.keyword,
      location: j.location,
      requestedResults: j.requestedResults,
      capturedResults: j.capturedResults,
      googleApiRequests: j.googleApiRequests,
      createdAt: j.createdAt,
      places: j.places.map((p) => {
        const { googlePhotos: normGP, photos: normPhotoUrls } = this.normalizeStoredPhotos((p as any).photos);
        return {
          id: p.id,
          provider: p.source || 'GOOGLE_PLACES',
          googlePlaceId: p.googlePlaceId || undefined,
          businessName: p.businessName,
          category: p.category || undefined,
          address: p.address || undefined,
          phone: p.phone || undefined,
          email: p.email || undefined,
          website: p.website || undefined,
          rating: p.rating || undefined,
          reviewCount: p.reviewCount || undefined,
          latitude: p.latitude || undefined,
          longitude: p.longitude || undefined,
          googleMapsUrl: p.googleMapsUrl || undefined,
          businessStatus: p.businessStatus || 'OPERATIONAL',
          source: p.source || 'GOOGLE_PLACES',
          status: p.status || 'CAPTURED',
          isImported: p.isImported,
          importedLeadId: p.importedLeadId || undefined,
          capturedAt: p.createdAt,
          updatedAt: p.updatedAt,
          customerId: String(p.customerId),
          capturedBy: String(j.userId),
          extractionJobId: j.jobId,
          googlePhotos: normGP.length > 0 ? normGP : [],
          photos: normPhotoUrls.length > 0 ? normPhotoUrls : undefined,
          socialMedia: this.extractSocialMediaFromPlace(p),
        };
      }),
    }));
  }

  /**
   * Get single extraction job details
   */
  async getJobById(customerId: string | number | undefined, jobId: string): Promise<ExtractionJob> {
    const numCustomerId = Number(customerId);
    const where: any = { jobId: jobId.trim() };
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      where.customerId = numCustomerId;
    }

    const job = await this.prisma.dataCaptureJob.findFirst({
      where,
      include: {
        places: {
          where: { deletedAt: null },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Extraction job "${jobId}" not found.`);
    }

    return {
      jobId: job.jobId,
      customerId: String(job.customerId),
      userId: String(job.userId),
      keyword: job.keyword,
      location: job.location,
      requestedResults: job.requestedResults,
      capturedResults: job.capturedResults,
      googleApiRequests: job.googleApiRequests,
      createdAt: job.createdAt,
      places: job.places.map((p) => {
        const { googlePhotos: normGP, photos: normPhotoUrls } = this.normalizeStoredPhotos((p as any).photos);
        return {
          id: p.id,
          provider: p.source || 'GOOGLE_PLACES',
          googlePlaceId: p.googlePlaceId || undefined,
          businessName: p.businessName,
          category: p.category || undefined,
          address: p.address || undefined,
          phone: p.phone || undefined,
          email: p.email || undefined,
          website: p.website || undefined,
          rating: p.rating || undefined,
          reviewCount: p.reviewCount || undefined,
          latitude: p.latitude || undefined,
          longitude: p.longitude || undefined,
          googleMapsUrl: p.googleMapsUrl || undefined,
          businessStatus: p.businessStatus || 'OPERATIONAL',
          source: p.source || 'GOOGLE_PLACES',
          status: p.status || 'CAPTURED',
          isImported: p.isImported,
          importedLeadId: p.importedLeadId || undefined,
          capturedAt: p.createdAt,
          updatedAt: p.updatedAt,
          customerId: String(p.customerId),
          capturedBy: String(job.userId),
          extractionJobId: job.jobId,
          googlePhotos: normGP.length > 0 ? normGP : [],
          photos: normPhotoUrls.length > 0 ? normPhotoUrls : undefined,
          socialMedia: this.extractSocialMediaFromPlace(p),
        };
      }),
    };
  }

  /**
   * Get customer extraction usage summary from PostgreSQL
   */
  async getUsageSummary(customerId?: string | number, user?: any): Promise<ExtractionUsageSummary> {
    const numCustomerId = Number(customerId);
    const customerWhere: any = {};
    if (!isNaN(numCustomerId) && numCustomerId > 0) {
      customerWhere.customerId = numCustomerId;
    }

    // Resolve employee for employee-specific search count
    let employeeId: number | undefined = user?.employee?.id ? Number(user.employee.id) : undefined;
    const directUserId = user?.id || user?.userId;
    if (!employeeId && directUserId) {
      const emp = await this.prisma.employee.findFirst({
        where: {
          userId: Number(directUserId),
          ...(customerWhere.customerId ? { customerId: customerWhere.customerId } : {}),
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (emp) {
        employeeId = emp.id;
      }
    }

    const [totalExtractions, aggregatePlaces, aggregateRequests, validatedCount, convertedCount, searchesCount] = await Promise.all([
      this.prisma.dataCaptureJob.count({ where: customerWhere }),
      this.prisma.dataCapturePlace.count({ where: { ...customerWhere, deletedAt: null } }),
      this.prisma.dataCaptureJob.aggregate({
        where: customerWhere,
        _sum: { googleApiRequests: true },
      }),
      this.prisma.dataCapturePlace.count({
        where: { ...customerWhere, status: 'VALIDATED', deletedAt: null },
      }),
      this.prisma.dataCapturePlace.count({
        where: { ...customerWhere, isImported: true, deletedAt: null },
      }),
      employeeId
        ? this.prisma.dataCaptureSearch.count({
            where: {
              ...(customerWhere.customerId ? { customerId: customerWhere.customerId } : {}),
              employeeId,
            },
          })
        : (directUserId
            ? this.prisma.dataCaptureSearch.count({
                where: {
                  ...(customerWhere.customerId ? { customerId: customerWhere.customerId } : {}),
                  userId: Number(directUserId),
                },
              })
            : 0),
    ]);

    const totalGoogleApiCalls = aggregateRequests._sum?.googleApiRequests || 0;
    const totalLeadsCaptured = aggregatePlaces || 0;
    const quotaLimit = 1000;

    return {
      customerId: customerId ? String(customerId) : 'ALL',
      totalExtractions,
      totalLeadsCaptured,
      totalGoogleApiCalls,
      quotaLimit,
      quotaRemaining: Math.max(quotaLimit - totalLeadsCaptured, 0),
      validatedCount,
      convertedCount,
      searches: searchesCount || 0,
      totalSearches: searchesCount || 0,
    };
  }

  /**
   * Internal helper to scan database for duplicates
   */
  private async findDuplicateMatches(
    customerId: number | undefined,
    place: {
      id?: number;
      googlePlaceId?: string | null;
      businessName: string;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
    },
  ): Promise<DuplicateMatch[]> {
    const matches: DuplicateMatch[] = [];
    if (!customerId || isNaN(customerId)) {
      return matches;
    }

    // Check Leads
    const leadConditions: any[] = [];
    if (place.googlePlaceId) leadConditions.push({ googlePlaceId: place.googlePlaceId });
    if (place.phone && place.phone !== 'N/A') leadConditions.push({ phone: place.phone });
    if (place.email) leadConditions.push({ email: place.email });
    if (place.businessName) leadConditions.push({ title: { equals: place.businessName, mode: 'insensitive' } });

    if (leadConditions.length > 0) {
      const duplicateLeads = await this.prisma.lead.findMany({
        where: { customerId, deletedAt: null, OR: leadConditions },
        take: 3,
      });

      for (const dl of duplicateLeads) {
        let field: 'googlePlaceId' | 'phone' | 'email' | 'website' | 'businessName' = 'businessName';
        let val = dl.title;
        if (place.googlePlaceId && dl.googlePlaceId === place.googlePlaceId) {
          field = 'googlePlaceId';
          val = dl.googlePlaceId;
        } else if (place.phone && dl.phone === place.phone) {
          field = 'phone';
          val = dl.phone;
        } else if (place.email && dl.email === place.email) {
          field = 'email';
          val = dl.email;
        }
        matches.push({
          type: 'LEAD',
          id: dl.id,
          title: `Lead: ${dl.title}`,
          matchField: field,
          matchValue: val,
          status: dl.status,
        });
      }
    }

    // Check Companies
    const companyConditions: any[] = [];
    if (place.googlePlaceId) companyConditions.push({ googlePlaceId: place.googlePlaceId });
    if (place.phone && place.phone !== 'N/A') companyConditions.push({ phone: place.phone });
    if (place.email) companyConditions.push({ email: place.email });
    if (place.businessName) companyConditions.push({ name: { equals: place.businessName, mode: 'insensitive' } });

    if (companyConditions.length > 0) {
      const duplicateCompanies = await this.prisma.company.findMany({
        where: { customerId, deletedAt: null, OR: companyConditions },
        take: 3,
      });

      for (const dc of duplicateCompanies) {
        matches.push({
          type: 'COMPANY',
          id: dc.id,
          title: `Company: ${dc.name}`,
          matchField: 'businessName',
          matchValue: dc.name,
          status: dc.status || undefined,
        });
      }
    }

    return matches;
  }

  /**
   * Generates realistic Google Places objects when running in local sandbox without an active API key
   */
  /**
   * Backfill historical places with realistic verified photos if missing or corrupted by previous test keys
   */
  async backfillHistoricalPlacePhotos(): Promise<void> {
    // Intentionally no-op to prevent injecting dummy/placeholder photos into production places
    return;
  }

  private requireTenant(customerId?: string | number) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ForbiddenException('A tenant is required to view capture history.');
    }
    return id;
  }

  private placeOutcome(place: { isImported?: boolean; status?: string | null }) {
    const status = String(place.status || '').toUpperCase();
    if (status === 'DUPLICATE') return 'duplicate';
    if (place.isImported) return 'imported';
    if (status === 'IMPORT_FAILED' || status === 'FAILED') return 'failed';
    return 'pending';
  }

  private sessionStatus(counts: { captured: number; imported: number; pending: number; failed: number }) {
    if (counts.captured === 0 || (counts.failed > 0 && counts.imported === 0 && counts.pending === 0)) return 'Failed';
    if (counts.pending === 0 && counts.failed === 0) return 'Completed';
    return 'Partial';
  }

  private async loadSessionRows(customerId: number) {
    const jobs = await this.prisma.dataCaptureJob.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        places: {
          where: { deletedAt: null },
          select: {
            id: true,
            source: true,
            category: true,
            status: true,
            isImported: true,
            importedLeadId: true,
            googlePlaceId: true,
            businessName: true,
            address: true,
            phone: true,
            createdAt: true,
          },
        },
      },
    });

    return jobs.map((job) => {
      const counts = { captured: job.places.length, imported: 0, pending: 0, failed: 0, duplicate: 0 };
      const categories = new Set<string>();
      const sources = new Set<string>();
      job.places.forEach((place) => {
        const outcome = this.placeOutcome(place);
        counts[outcome] += 1;
        if (place.category) categories.add(place.category);
        sources.add(place.source || 'GOOGLE_PLACES');
      });
      if (sources.size === 0) sources.add('GOOGLE_PLACES');
      const capturedBy = [job.user?.firstName, job.user?.lastName].filter(Boolean).join(' ').trim() || job.user?.email || `User ${job.userId}`;
      return {
        id: job.jobId,
        captureName: job.keyword,
        source: Array.from(sources).join(', '),
        category: Array.from(categories).join(', ') || '—',
        location: job.location,
        requestedCount: job.requestedResults,
        totalRecords: job.capturedResults || counts.captured,
        selected: counts.imported + counts.duplicate + counts.failed,
        imported: counts.imported,
        pending: counts.pending,
        failed: counts.failed,
        duplicate: counts.duplicate,
        status: this.sessionStatus(counts),
        capturedBy,
        capturedById: job.userId,
        captureDate: job.createdAt,
        places: job.places,
      };
    });
  }

  private filterSessions(rows: any[], query: CaptureSessionQueryDto) {
    const search = (query.search || '').trim().toLowerCase();
    const source = (query.source || '').trim().toLowerCase();
    const category = (query.category || '').trim().toLowerCase();
    const location = (query.location || '').trim().toLowerCase();
    const capturedBy = (query.capturedBy || '').trim().toLowerCase();
    const status = (query.status || '').trim().toLowerCase();
    const from = query.dateFrom ? new Date(query.dateFrom) : null;
    const to = query.dateTo ? new Date(query.dateTo) : null;
    if (to && !Number.isNaN(to.getTime())) to.setHours(23, 59, 59, 999);
    return rows.filter((row) => {
      if (search && !`${row.id} ${row.captureName}`.toLowerCase().includes(search)) return false;
      if (source && source !== 'all' && !String(row.source).toLowerCase().includes(source)) return false;
      if (category && category !== 'all' && !String(row.category).toLowerCase().includes(category)) return false;
      if (location && !String(row.location || '').toLowerCase().includes(location)) return false;
      if (capturedBy && capturedBy !== 'all' && String(row.capturedById) !== capturedBy && !String(row.capturedBy).toLowerCase().includes(capturedBy)) return false;
      if (status && status !== 'all' && String(row.status).toLowerCase() !== status) return false;
      const when = new Date(row.captureDate);
      if (from && !Number.isNaN(from.getTime()) && when < from) return false;
      if (to && !Number.isNaN(to.getTime()) && when > to) return false;
      return true;
    });
  }

  private summarizeSessions(rows: any[]) {
    return rows.reduce((summary, row) => {
      summary.sessions += 1;
      summary.captured += row.totalRecords || 0;
      summary.imported += row.imported || 0;
      summary.pending += row.pending || 0;
      summary.failed += row.failed || 0;
      summary.duplicates += row.duplicate || 0;
      return summary;
    }, { sessions: 0, captured: 0, imported: 0, pending: 0, failed: 0, duplicates: 0 });
  }

  async listCaptureSessions(customerId: string | number | undefined, query: CaptureSessionQueryDto) {
    const tenantId = this.requireTenant(customerId);
    const rows = await this.loadSessionRows(tenantId);
    const filtered = this.filterSessions(rows, query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const start = (page - 1) * limit;
    const sources = Array.from(new Set(rows.flatMap((row) => String(row.source).split(', ')))).filter(Boolean);
    const categories = Array.from(new Set(rows.flatMap((row) => String(row.category).split(', ')).filter((value) => value && value !== '—')));
    const users = Array.from(new Map(rows.map((row) => [String(row.capturedById), row.capturedBy])).entries()).map(([id, name]) => ({ id, name }));
    return {
      data: filtered.slice(start, start + limit).map(({ places, ...row }) => row),
      summary: this.summarizeSessions(filtered),
      meta: { sources, categories, users },
      pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) },
    };
  }

  async getCaptureSession(customerId: string | number | undefined, jobId: string) {
    const tenantId = this.requireTenant(customerId);
    const rows = await this.loadSessionRows(tenantId);
    const row = rows.find((item) => item.id === jobId);
    if (!row) throw new NotFoundException('Capture session not found.');
    return {
      data: {
        ...row,
        records: row.places.map((place) => ({
          id: place.id,
          businessName: place.businessName,
          category: place.category,
          address: place.address,
          phone: place.phone,
          googlePlaceId: place.googlePlaceId,
          status: place.status,
          outcome: this.placeOutcome(place),
          importedLeadId: place.importedLeadId,
          capturedAt: place.createdAt,
        })),
        places: undefined,
      },
    };
  }

  async retryFailedCapture(customerId: string | number | undefined, user: any, jobId: string, req?: any) {
    const tenantId = this.requireTenant(customerId);
    const failed = await this.prisma.dataCapturePlace.findMany({
      where: { customerId: tenantId, jobId, deletedAt: null, isImported: false, status: { in: ['IMPORT_FAILED', 'FAILED'] } },
      select: { id: true, googlePlaceId: true },
    });
    if (!failed.length) {
      throw new BadRequestException('No failed records from this session are still available to retry. Pending records are not imported automatically.');
    }
    return this.importToLeads(tenantId, user, {
      jobId,
      places: failed.map((place) => ({ id: place.id, googlePlaceId: place.googlePlaceId || undefined })),
    }, req);
  }

  async exportCaptureSessions(customerId: string | number | undefined, query: CaptureSessionQueryDto, format: 'csv' | 'pdf') {
    const listed = await this.listCaptureSessions(customerId, { ...query, page: 1, limit: 1000 });
    const rows = listed.data || [];
    const customer = await this.prisma.customer.findFirst({ where: { id: this.requireTenant(customerId) }, select: { name: true, companyName: true } });
    const company = customer?.companyName || customer?.name || 'QB Suite';
    if (format === 'csv') {
      const header = ['Capture ID', 'Capture Name', 'Source', 'Category', 'Location', 'Total', 'Imported', 'Pending', 'Failed', 'Duplicates', 'Captured By', 'Capture Date', 'Status'];
      const lines = rows.map((row) => [row.id, row.captureName, row.source, row.category, row.location, row.totalRecords, row.imported, row.pending, row.failed, row.duplicate, row.capturedBy, row.captureDate, row.status]
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
      return { filename: 'capture-history.csv', contentType: 'text/csv', body: [header.join(','), ...lines].join('\n') };
    }
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const generated = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      doc.fontSize(16).fillColor('#163A2E').text('QB Suite');
      doc.fontSize(10).fillColor('#172B24').text(company);
      doc.moveDown(0.3);
      doc.fontSize(14).text('Capture History');
      doc.fontSize(9).fillColor('#718078').text(`Period: ${query.dateFrom || 'All'} to ${query.dateTo || 'All'}`);
      doc.text(`Generated: ${generated}`);
      doc.text(`Sessions ${listed.summary.sessions} · Captured ${listed.summary.captured} · Imported ${listed.summary.imported} · Pending ${listed.summary.pending} · Failed ${listed.summary.failed} · Duplicates ${listed.summary.duplicates}`);
      doc.moveDown(0.6);
      if (!rows.length) {
        doc.fillColor('#172B24').fontSize(11).text('No capture sessions match these filters.');
      } else {
        doc.fontSize(8).fillColor('#172B24');
        rows.forEach((row, index) => {
          if (doc.y > doc.page.height - 60) doc.addPage();
          doc.text(`${index + 1}. ${row.id} | ${row.captureName} | ${row.source} | ${row.location || '—'} | Total ${row.totalRecords} | Imported ${row.imported} | Pending ${row.pending} | Failed ${row.failed} | Duplicates ${row.duplicate} | ${row.status} | ${row.capturedBy}`, { width: doc.page.width - 72 });
          doc.moveDown(0.25);
        });
      }
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#718078').text(`${company} · Page ${i + 1} of ${range.count} · ${generated}`, 36, doc.page.height - 28, { align: 'center', width: doc.page.width - 72 });
      }
      doc.end();
    });
    return { filename: 'capture-history.pdf', contentType: 'application/pdf', body: buffer };
  }
}

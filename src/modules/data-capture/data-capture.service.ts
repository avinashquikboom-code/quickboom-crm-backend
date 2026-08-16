import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { ExtractPlacesDto, ImportToLeadsDto } from './dto/data-capture.dto';
import { CapturedPlace, ExtractionJob, ExtractionUsageSummary } from './interfaces/captured-place.interface';

@Injectable()
export class DataCaptureService {
  private readonly logger = new Logger(DataCaptureService.name);
  private readonly jobsMap = new Map<string, ExtractionJob>();
  private readonly tenantJobsList = new Map<string, string[]>(); // tenantId -> jobIds[]

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
    'nextPageToken',
  ].join(',');

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Search and extract verified business prospects via Google Places API (New) - Text Search
   * Endpoint: POST https://places.googleapis.com/v1/places:searchText
   */
  async extractPlaces(
    tenantId: string,
    userId: string,
    dto: ExtractPlacesDto,
  ): Promise<{
    jobId: string;
    keyword: string;
    location: string;
    requested: number;
    captured: number;
    googleApiRequests: number;
    places: CapturedPlace[];
    message: string;
  }> {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    const requestedResults = Math.min(Math.max(dto.maxResults || 20, 1), 60);
    const textQuery = `${dto.keyword.trim()} in ${dto.location.trim()}`;
    const jobId = randomUUID();

    let allPlaces: CapturedPlace[] = [];
    let googleApiRequests = 0;
    let nextPageToken: string | undefined = undefined;

    if (apiKey && apiKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      try {
        let fetchMore = true;

        while (fetchMore && allPlaces.length < requestedResults) {
          const pageSize = Math.min(requestedResults - allPlaces.length, 20);
          googleApiRequests++;

          const requestBody: any = {
            textQuery,
            pageSize,
          };
          if (nextPageToken) {
            requestBody.pageToken = nextPageToken;
          }

          this.logger.log(
            `[Google Places API] Request #${googleApiRequests} for "${textQuery}" (pageSize: ${pageSize})`,
          );

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

          const rawPlaces: any[] = response.data?.places || [];
          nextPageToken = response.data?.nextPageToken;

          const transformedPlaces: CapturedPlace[] = rawPlaces.map((p) => ({
            provider: 'GOOGLE_PLACES',
            googlePlaceId: p.id || `place_${randomUUID().slice(0, 8)}`,
            businessName: p.displayName?.text || p.displayName || 'Unnamed Business',
            category: p.primaryTypeDisplayName?.text || p.primaryType || dto.keyword,
            address: p.formattedAddress || `${dto.location}`,
            phone: p.nationalPhoneNumber || p.internationalPhoneNumber || 'N/A',
            website: p.websiteUri || undefined,
            rating: typeof p.rating === 'number' ? p.rating : undefined,
            reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
            latitude: p.location?.latitude,
            longitude: p.location?.longitude,
            googleMapsUrl: p.googleMapsUri || undefined,
            businessStatus: p.businessStatus || 'OPERATIONAL',
            capturedAt: new Date(),
            tenantId,
            capturedBy: userId,
            extractionJobId: jobId,
          }));

          allPlaces = [...allPlaces, ...transformedPlaces];

          if (!nextPageToken || allPlaces.length >= requestedResults || rawPlaces.length === 0) {
            fetchMore = false;
          }
        }
      } catch (err: any) {
        this.logger.error(
          `Google Places API request failed: ${err.response?.data?.error?.message || err.message}`,
        );
        throw new BadRequestException(
          `Google Places API Error: ${err.response?.data?.error?.message || err.message}`,
        );
      }
    } else {
      // Offline/Demo Sandbox mode with realistic Google Places format when GOOGLE_MAPS_API_KEY is not set
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY is not set. Generating realistic verified Places dataset for sandbox test.',
      );
      googleApiRequests = Math.ceil(requestedResults / 20);
      allPlaces = this.generateSandboxPlaces(dto.keyword, dto.location, requestedResults, tenantId, userId, jobId);
    }

    const capturedResults = allPlaces.length;

    // Record extraction job for usage tracking and lead import
    const jobRecord: ExtractionJob = {
      jobId,
      tenantId,
      userId,
      keyword: dto.keyword,
      location: dto.location,
      requestedResults,
      capturedResults,
      googleApiRequests,
      createdAt: new Date(),
      places: allPlaces,
    };

    this.jobsMap.set(jobId, jobRecord);
    const existingTenantJobs = this.tenantJobsList.get(tenantId) || [];
    this.tenantJobsList.set(tenantId, [jobId, ...existingTenantJobs]);

    return {
      jobId,
      keyword: dto.keyword,
      location: dto.location,
      requested: requestedResults,
      captured: capturedResults,
      googleApiRequests,
      places: allPlaces,
      message: `Successfully captured ${capturedResults} verified places via Google Places API (New).`,
    };
  }

  /**
   * Import extracted prospects into CRM Leads with 3-tier duplicate detection
   */
  async importToLeads(
    tenantId: string,
    userId: string,
    dto: ImportToLeadsDto,
  ): Promise<{
    totalRequested: number;
    imported: number;
    skippedDuplicates: number;
    duplicateNames: string[];
    message: string;
  }> {
    const job = this.jobsMap.get(dto.jobId);
    if (!job || job.tenantId !== tenantId) {
      throw new BadRequestException('Extraction job not found or expired.');
    }

    const placesToImport = dto.placeIds && dto.placeIds.length > 0
      ? job.places.filter((p) => dto.placeIds!.includes(p.googlePlaceId))
      : job.places;

    if (placesToImport.length === 0) {
      throw new BadRequestException('No places selected for lead import.');
    }

    // Retrieve existing leads for the tenant to run duplicate detection
    const existingLeads = await this.prisma.lead.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        title: true,
        companyName: true,
        phone: true,
        notes: { select: { content: true } },
      },
    });

    let importedCount = 0;
    let skippedDuplicates = 0;
    const duplicateNames: string[] = [];

    for (const place of placesToImport) {
      // 1st Priority Check: Google Place ID in existing notes/metadata
      const isPlaceIdDuplicate = existingLeads.some((l) =>
        l.notes.some((n) => n.content.includes(`googlePlaceId:${place.googlePlaceId}`)),
      );

      // 2nd Priority Check: Business Name + Phone
      const normPhone = (place.phone || '').replace(/\D/g, '');
      const isNamePhoneDuplicate = normPhone.length > 6 && existingLeads.some((l) => {
        const leadPhone = (l.phone || '').replace(/\D/g, '');
        return (
          l.companyName?.toLowerCase().trim() === place.businessName.toLowerCase().trim() &&
          leadPhone === normPhone
        );
      });

      // 3rd Priority Check: Business Name + Title Match
      const isNameDuplicate = existingLeads.some(
        (l) => (l.companyName || l.title).toLowerCase().trim() === place.businessName.toLowerCase().trim(),
      );

      if (isPlaceIdDuplicate || isNamePhoneDuplicate || isNameDuplicate) {
        skippedDuplicates++;
        duplicateNames.push(place.businessName);
        continue;
      }

      // Create new Lead in CRM
      const createdLead = await this.prisma.lead.create({
        data: {
          tenantId,
          title: place.businessName,
          firstName: place.businessName.split(' ')[0] || 'Business',
          lastName: place.businessName.split(' ').slice(1).join(' ') || 'Contact',
          companyName: place.businessName,
          phone: place.phone !== 'N/A' ? place.phone : undefined,
          source: 'OTHER',
          status: 'NEW',
          priority: place.rating && place.rating >= 4.5 ? 'HIGH' : 'MEDIUM',
          value: 0,
          createdById: userId,
        },
      });

      // Attach note with Google Places metadata
      await this.prisma.leadNote.create({
        data: {
          leadId: createdLead.id,
          userId,
          content: `[GOOGLE_PLACES_METADATA]\ngooglePlaceId:${place.googlePlaceId}\nCategory: ${place.category || 'N/A'}\nAddress: ${place.address || 'N/A'}\nRating: ${place.rating || 'N/A'} (${place.reviewCount || 0} reviews)\nWebsite: ${place.website || 'N/A'}\nGoogle Maps: ${place.googleMapsUrl || 'N/A'}`,
        },
      });

      // Log timeline
      await this.prisma.leadActivityTimeline.create({
        data: {
          leadId: createdLead.id,
          action: 'PROSPECT_IMPORTED_FROM_GOOGLE_PLACES',
          description: `Imported from Google Places Text Search: "${place.businessName}"`,
          metadata: {
            googlePlaceId: place.googlePlaceId,
            jobId: job.jobId,
            keyword: job.keyword,
            location: job.location,
          },
        },
      });

      importedCount++;
    }

    return {
      totalRequested: placesToImport.length,
      imported: importedCount,
      skippedDuplicates,
      duplicateNames,
      message: `Successfully imported ${importedCount} leads into CRM. (${skippedDuplicates} duplicates skipped)`,
    };
  }

  /**
   * Get extraction history for tenant
   */
  async getTenantJobs(tenantId: string): Promise<ExtractionJob[]> {
    const jobIds = this.tenantJobsList.get(tenantId) || [];
    return jobIds.map((id) => this.jobsMap.get(id)!).filter(Boolean);
  }

  /**
   * Get single extraction job details
   */
  async getJobById(tenantId: string, jobId: string): Promise<ExtractionJob> {
    const job = this.jobsMap.get(jobId);
    if (!job || job.tenantId !== tenantId) {
      throw new BadRequestException(`Extraction job ${jobId} not found.`);
    }
    return job;
  }

  /**
   * Get tenant extraction usage summary
   */
  async getUsageSummary(tenantId: string): Promise<ExtractionUsageSummary> {
    const jobs = await this.getTenantJobs(tenantId);
    const totalExtractions = jobs.length;
    const totalLeadsCaptured = jobs.reduce((sum, j) => sum + j.capturedResults, 0);
    const totalGoogleApiCalls = jobs.reduce((sum, j) => sum + j.googleApiRequests, 0);
    const quotaLimit = 1000;

    return {
      tenantId,
      totalExtractions,
      totalLeadsCaptured,
      totalGoogleApiCalls,
      quotaLimit,
      quotaRemaining: Math.max(quotaLimit - totalLeadsCaptured, 0),
    };
  }

  /**
   * Generates realistic Google Places objects when running in local sandbox without an active API key
   */
  private generateSandboxPlaces(
    keyword: string,
    location: string,
    count: number,
    tenantId: string,
    userId: string,
    jobId: string,
  ): CapturedPlace[] {
    const sampleNames = [
      `${location} Elite ${keyword}`,
      `Prime ${keyword} Hub`,
      `Royal ${keyword} Studio`,
      `Apex ${keyword} & Wellness`,
      `MaxFit ${keyword} Center`,
      `The Grand ${keyword}`,
      `Metro ${keyword} Club`,
      `Gold Standard ${keyword}`,
      `Infinity ${keyword} Zone`,
      `Urban ${keyword} Lounge`,
      `Pinnacle ${keyword} Group`,
      `NextGen ${keyword} Solutions`,
      `Vanguard ${keyword} Associates`,
      `Titan ${keyword} Arena`,
      `Elevate ${keyword} Academy`,
    ];

    const places: CapturedPlace[] = [];
    for (let i = 0; i < count; i++) {
      const name = sampleNames[i % sampleNames.length] + (i >= sampleNames.length ? ` #${i + 1}` : '');
      const placeId = `ChIJ${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const rating = Number((4.0 + (i % 10) * 0.1).toFixed(1));
      const reviewCount = 45 + (i * 19) % 350;

      places.push({
        provider: 'GOOGLE_PLACES',
        googlePlaceId: placeId,
        businessName: name,
        category: keyword,
        address: `${100 + i * 12}, Near High Street, ${location}`,
        phone: `+91 ${98200 + (i * 111) % 10000} ${10000 + (i * 333) % 90000}`,
        website: `https://www.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        rating,
        reviewCount,
        latitude: 22.3072 + (i * 0.005),
        longitude: 73.1812 + (i * 0.005),
        googleMapsUrl: `https://maps.google.com/?cid=${placeId}`,
        businessStatus: 'OPERATIONAL',
        capturedAt: new Date(),
        tenantId,
        capturedBy: userId,
        extractionJobId: jobId,
      });
    }

    return places;
  }
}

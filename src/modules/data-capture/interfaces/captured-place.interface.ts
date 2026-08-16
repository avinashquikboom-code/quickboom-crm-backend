export interface CapturedPlace {
  provider: 'GOOGLE_PLACES';
  googlePlaceId: string;
  businessName: string;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  businessStatus?: string;
  capturedAt: Date;
  tenantId: string;
  capturedBy: string;
  extractionJobId: string;
}

export interface ExtractionJob {
  jobId: string;
  tenantId: string;
  userId: string;
  keyword: string;
  location: string;
  requestedResults: number;
  capturedResults: number;
  googleApiRequests: number;
  createdAt: Date;
  places: CapturedPlace[];
}

export interface ExtractionUsageSummary {
  tenantId: string;
  totalExtractions: number;
  totalLeadsCaptured: number;
  totalGoogleApiCalls: number;
  quotaLimit: number;
  quotaRemaining: number;
}

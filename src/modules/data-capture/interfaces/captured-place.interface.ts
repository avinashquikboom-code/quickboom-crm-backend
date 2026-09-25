export interface GooglePlacePhoto {
  name: string;
  url: string;
  width?: number;
  height?: number;
}

export interface CapturedPlace {
  id?: number;
  provider: 'GOOGLE_PLACES' | 'MANUAL' | 'CSV_IMPORT' | string;
  googlePlaceId?: string;
  businessName: string;
  category?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  businessStatus?: string;
  source?: string;
  status?: string;
  notes?: string;
  rawData?: any;
  isImported?: boolean;
  importedLeadId?: number;
  capturedAt: Date | string;
  updatedAt?: Date | string;
  customerId: string;
  capturedBy?: string;
  extractionJobId?: string;
  duplicateMatches?: DuplicateMatch[];
  /** Array of structured Google Places photos with photo resource name and URL */
  googlePhotos?: GooglePlacePhoto[];
  /** Array of resolved Google photo URLs for this business (from Google Places API) */
  photos?: string[];
  /** Discovered social media handles & website */
  socialMedia?: SocialMediaHandles;
}

export interface SocialMediaHandles {
  website?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  [key: string]: string | undefined;
}


export interface DuplicateMatch {
  type: 'LEAD' | 'COMPANY' | 'CONTACT' | 'DATA_CAPTURE';
  id: number;
  title: string;
  matchField: 'googlePlaceId' | 'phone' | 'email' | 'website' | 'businessName';
  matchValue: string;
  status?: string;
}

export interface ExtractionJob {
  jobId: string;
  customerId: string;
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
  customerId: string;
  totalExtractions: number;
  totalLeadsCaptured: number;
  totalGoogleApiCalls: number;
  quotaLimit: number;
  quotaRemaining: number;
  validatedCount?: number;
  convertedCount?: number;
  searches?: number;
  totalSearches?: number;
}

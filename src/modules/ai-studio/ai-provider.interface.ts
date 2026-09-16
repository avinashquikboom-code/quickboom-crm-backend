export interface TextGenerationResult {
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface ImageGenerationResult {
  buffer?: Buffer;
  url?: string;
  fileKey?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface VideoGenerationResult {
  jobId: string;
  url?: string;
  fileKey?: string;
  duration?: number;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

export interface IAiProvider {
  generateText(params: {
    product: string;
    type: string;
    objective?: string;
    platform?: string;
    language?: string;
    tone?: string;
    cta?: string;
    instructions?: string;
  }): Promise<TextGenerationResult>;

  generateImage(params: {
    product: string;
    objective?: string;
    platform?: string;
    tone?: string;
    cta?: string;
    instructions?: string;
    referenceImageUrl?: string;
  }): Promise<ImageGenerationResult>;

  startVideoJob(params: {
    product: string;
    objective?: string;
    platform?: string;
    language?: string;
    tone?: string;
    cta?: string;
    duration?: number;
  }): Promise<VideoGenerationResult>;

  checkVideoJobStatus(jobId: string): Promise<VideoGenerationResult>;
}

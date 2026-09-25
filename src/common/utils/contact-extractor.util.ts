import axios from 'axios';

/**
 * Robust, production-grade contact extraction and normalization utility
 * for Data Capture, Google Discovery, and Lead pipelines.
 */

const PLACEHOLDER_EMAILS = new Set([
  'contact@company.com',
  'placeholder@company.com',
  'example@company.com',
  'test@company.com',
  'test@example.com',
  'user@company.com',
  'admin@quikboom.com',
  'info@company.com',
  'support@company.com',
  'domain@example.com',
  'email@example.com',
  'sample@example.com',
]);

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export class ContactExtractor {
  /**
   * Normalize a phone number into standard international format (+91XXXXXXXXXX or +E.164).
   * Returns null if missing, placeholder, or invalid.
   */
  static normalizePhoneNumber(raw?: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!str) return null;

    // Check invalid / N/A tokens
    const upper = str.toUpperCase();
    if (
      upper === 'N/A' ||
      upper === 'NA' ||
      upper === 'NONE' ||
      upper === 'NULL' ||
      upper === '-' ||
      upper === 'UNDEFINED'
    ) {
      return null;
    }

    // Strip tel: prefix if present
    if (str.toLowerCase().startsWith('tel:')) {
      str = str.substring(4).trim();
    }

    // Strip label words (e.g. "Phone:", "Mobile:", "Tel:", "Call:", "WhatsApp:")
    str = str.replace(/^(?:phone|mobile|tel|call|whatsapp|contact)\s*[:\-]\s*/i, '').trim();

    // Remove any query params or hash (e.g. from links)
    str = str.split('?')[0].split('#')[0].trim();

    // Check if original had leading plus
    const hasPlus = str.startsWith('+');

    // Extract digits only
    const digits = str.replace(/\D/g, '');
    if (!digits) return null;

    // Handle 11 digits with leading 0 (e.g. 09876543210 -> 9876543210)
    let processedDigits = digits;
    if (processedDigits.startsWith('0') && processedDigits.length === 11) {
      processedDigits = processedDigits.substring(1);
    }

    // 10-digit Indian mobile number (starts with 6, 7, 8, or 9)
    if (processedDigits.length === 10 && /^[6-9]\d{9}$/.test(processedDigits)) {
      return `+91${processedDigits}`;
    }

    // 12-digit Indian mobile number starting with 91 followed by 6-9
    if (processedDigits.length === 12 && processedDigits.startsWith('91') && /^91[6-9]\d{9}$/.test(processedDigits)) {
      return `+${processedDigits}`;
    }

    // International numbers (between 10 and 15 digits)
    if (processedDigits.length >= 10 && processedDigits.length <= 15) {
      return `+${processedDigits}`;
    }

    // If 7-9 digits (e.g. Indian landline without std code or partial), don't treat as valid mobile
    return null;
  }

  /**
   * Normalize and validate an email address.
   * Strips mailto:, surrounding quotes/brackets, lowercases, validates RFC regex, and rejects placeholders.
   */
  static normalizeEmail(raw?: any): string | null {
    if (raw === null || raw === undefined) return null;
    let str = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!str) return null;

    // Check invalid / N/A tokens
    const upper = str.toUpperCase();
    if (
      upper === 'N/A' ||
      upper === 'NA' ||
      upper === 'NONE' ||
      upper === 'NULL' ||
      upper === '-' ||
      upper === 'UNDEFINED'
    ) {
      return null;
    }

    // Strip mailto: prefix
    if (str.toLowerCase().startsWith('mailto:')) {
      str = str.substring(7).trim();
    }

    // Remove query params (e.g. mailto:foo@bar.com?subject=...)
    str = str.split('?')[0].split('#')[0].trim();

    // Strip surrounding brackets <...>, quotes, parentheses
    str = str.replace(/^[<"'\(\[]+/, '').replace(/[>"'\)\]]+$/, '').trim();

    // Convert to lowercase
    const lower = str.toLowerCase();

    // Validate email format
    if (!EMAIL_REGEX.test(lower)) {
      return null;
    }

    // Filter placeholder emails
    if (PLACEHOLDER_EMAILS.has(lower)) {
      return null;
    }

    return lower;
  }

  /**
   * Extract phone number from text, HTML, or structured JSON-LD.
   */
  static extractPhoneFromText(content: string): string | null {
    if (!content || typeof content !== 'string') return null;

    // 1. Check HTML <a href="tel:...">
    const telMatch = content.match(/<a\s+[^>]*href=["']tel:([^"'\s?]+)["']/i);
    if (telMatch && telMatch[1]) {
      const normalized = this.normalizePhoneNumber(telMatch[1]);
      if (normalized) return normalized;
    }

    // 2. Check JSON-LD "telephone": "..."
    const jsonLdMatch = content.match(/"telephone"\s*:\s*["']([^"']+)["']/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      const normalized = this.normalizePhoneNumber(jsonLdMatch[1]);
      if (normalized) return normalized;
    }

    // 3. Check labeled text pattern: Phone: +91 ..., Tel: ...
    const labelMatch = content.match(/(?:phone|mobile|tel|call|whatsapp|contact)\s*[:\-]?\s*(\+?[\d\s\-()]{10,20})/i);
    if (labelMatch && labelMatch[1]) {
      const normalized = this.normalizePhoneNumber(labelMatch[1]);
      if (normalized) return normalized;
    }

    // 4. Check raw Indian mobile format in text (+91 98765 43210 or 9876543210)
    const indianMatch = content.match(/(?:\+91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}\b/);
    if (indianMatch && indianMatch[0]) {
      const normalized = this.normalizePhoneNumber(indianMatch[0]);
      if (normalized) return normalized;
    }

    return null;
  }

  /**
   * Extract email from text, HTML, or structured JSON-LD.
   */
  static extractEmailFromText(content: string): string | null {
    if (!content || typeof content !== 'string') return null;

    // 1. Check HTML <a href="mailto:...">
    const mailtoMatch = content.match(/<a\s+[^>]*href=["']mailto:([^"'\s?]+)["']/i);
    if (mailtoMatch && mailtoMatch[1]) {
      const normalized = this.normalizeEmail(mailtoMatch[1]);
      if (normalized) return normalized;
    }

    // 2. Check JSON-LD "email": "..."
    const jsonLdMatch = content.match(/"email"\s*:\s*["']([^"']+)["']/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
      const normalized = this.normalizeEmail(jsonLdMatch[1]);
      if (normalized) return normalized;
    }

    // 3. Check meta tags <meta name="email" content="...">
    const metaMatch = content.match(/<meta\s+[^>]*name=["'](?:email|contact)["'][^>]*content=["']([^"']+)["']/i);
    if (metaMatch && metaMatch[1]) {
      const normalized = this.normalizeEmail(metaMatch[1]);
      if (normalized) return normalized;
    }

    // 4. Check regex match in content
    const emailMatches = content.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g);
    if (emailMatches && emailMatches.length > 0) {
      for (const m of emailMatches) {
        const normalized = this.normalizeEmail(m);
        if (normalized) return normalized;
      }
    }

    return null;
  }

  /**
   * Extract social media profile links (Facebook, Instagram, LinkedIn, Twitter/X, YouTube) from website HTML.
   */
  static extractSocialMediaFromHtml(html: string): {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
  } {
    if (!html || typeof html !== 'string') return {};

    const social: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
    } = {};

    // 1. Facebook
    const fbMatch = html.match(
      /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/(?:pages\/[a-zA-Z0-9_.-]+\/\d+|profile\.php\?id=\d+|[a-zA-Z0-9._-]+)(?=[?"'\s>])/i,
    );
    if (fbMatch && fbMatch[0]) {
      const url = fbMatch[0].replace(/\/+$/, '');
      const lower = url.toLowerCase();
      if (!/(sharer|share\.php|dialog|login|plugins|events|help|policies|home\.php)/.test(lower)) {
        social.facebook = url;
      }
    }

    // 2. Instagram
    const igMatch = html.match(
      /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30})(?=[/?"'\s>])/i,
    );
    if (igMatch && igMatch[1]) {
      const handle = igMatch[1].toLowerCase();
      if (!['p', 'explore', 'stories', 'reels', 'reel', 'about', 'legal', 'accounts', 'developer'].includes(handle)) {
        social.instagram = `https://www.instagram.com/${igMatch[1]}`;
      }
    }

    // 3. LinkedIn
    const liMatch = html.match(
      /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/([a-zA-Z0-9\-_%]+)(?=[/?"'\s>])/i,
    );
    if (liMatch && liMatch[0]) {
      const url = liMatch[0].replace(/\/+$/, '');
      if (!url.toLowerCase().includes('/share') && !url.toLowerCase().includes('/sharing')) {
        social.linkedin = url;
      }
    }

    // 4. Twitter / X
    const twMatch = html.match(
      /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,20})(?=[/?"'\s>])/i,
    );
    if (twMatch && twMatch[1]) {
      const handle = twMatch[1].toLowerCase();
      if (!['intent', 'share', 'home', 'explore', 'search', 'hashtag', 'tos', 'privacy', 'login', 'signup'].includes(handle)) {
        social.twitter = `https://x.com/${twMatch[1]}`;
      }
    }

    // 5. YouTube
    const ytMatch = html.match(
      /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)?([a-zA-Z0-9\-_]+)(?=[/?"'\s>])/i,
    );
    if (ytMatch && ytMatch[0]) {
      const url = ytMatch[0].replace(/\/+$/, '');
      const lower = url.toLowerCase();
      if (!/(watch|embed|results|shorts|feed|playlist|live)/.test(lower)) {
        social.youtube = url;
      }
    }

    return social;
  }

  /**
   * Safely attempt to extract contact email, phone, and social media from a business website with timeout and content caps.
   */
  static async extractContactFromWebsite(
    websiteUrl: string,
  ): Promise<{
    email: string | null;
    phone: string | null;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
    };
  }> {
    if (!websiteUrl || typeof websiteUrl !== 'string') {
      return { email: null, phone: null };
    }

    let cleanUrl = websiteUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    try {
      const response = await axios.get(cleanUrl, {
        timeout: 3500,
        maxContentLength: 500_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuikBoom-CRM-Discovery/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const html = typeof response.data === 'string' ? response.data : '';
      if (!html) return { email: null, phone: null };

      const email = this.extractEmailFromText(html);
      const phone = this.extractPhoneFromText(html);
      const socialMedia = this.extractSocialMediaFromHtml(html);

      return { email, phone, socialMedia: Object.keys(socialMedia).length > 0 ? socialMedia : undefined };
    } catch {
      // Graceful fallback on network timeout, blocked crawler, or invalid SSL
      return { email: null, phone: null };
    }
  }

  /**
   * Normalize website URL by ensuring protocol and removing tracking query parameters.
   */
  static normalizeWebsiteUrl(url?: string | null): string | null {
    if (!url || typeof url !== 'string') return null;
    let trimmed = url.trim();
    if (!trimmed) return null;

    const upper = trimmed.toUpperCase();
    if (upper === 'N/A' || upper === 'NA' || upper === 'NONE' || upper === 'NULL') {
      return null;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = `https://${trimmed}`;
    }

    try {
      const parsed = new URL(trimmed);
      parsed.hash = '';
      // Remove common analytics / tracking parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
      for (const p of trackingParams) {
        parsed.searchParams.delete(p);
      }
      let result = parsed.toString();
      if (result.endsWith('/') && !trimmed.endsWith('/')) {
        result = result.slice(0, -1);
      }
      return result;
    } catch {
      return trimmed;
    }
  }

  /**
   * Clean and normalize company / business name.
   */
  static normalizeCompanyName(name?: string | null): string {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/\s+/g, ' ').trim();
  }
}

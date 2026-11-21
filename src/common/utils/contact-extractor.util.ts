import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';

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
  private static isPublicIpv4(address: string): boolean {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) || (a === 203 && b === 0));
  }

  private static async publicIpv4For(hostname: string): Promise<string> {
    if (isIP(hostname)) {
      if (isIP(hostname) !== 4 || !this.isPublicIpv4(hostname)) throw new Error('Website host is not public.');
      return hostname;
    }
    const addresses = await lookup(hostname, { all: true, family: 4, verbatim: true });
    const publicAddress = addresses.find(({ address }) => this.isPublicIpv4(address));
    if (!publicAddress || addresses.some(({ address }) => !this.isPublicIpv4(address))) {
      throw new Error('Website host did not resolve exclusively to public addresses.');
    }
    return publicAddress.address;
  }

  private static async getPublicHtml(input: string): Promise<{ url: URL; html: string }> {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid website URL.');
      if (url.port && url.port !== '443') throw new Error('Non-standard website ports are not supported.');
      const address = await this.publicIpv4For(url.hostname);
      const agentOptions = {
        lookup: (_hostname: string, options: any, callback: (...args: any[]) => void) => {
          if (options?.all) callback(null, [{ address, family: 4 }]);
          else callback(null, address, 4);
        },
      };
      let response: any;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await axios.get(url.toString(), {
            timeout: 3500,
            maxContentLength: 500_000,
            maxBodyLength: 500_000,
            maxRedirects: 0,
            httpAgent: new http.Agent(agentOptions),
            httpsAgent: new https.Agent(agentOptions),
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; QuikBoom-CRM-Discovery/1.0)',
              Accept: 'text/html,application/xhtml+xml;q=0.9',
            },
            validateStatus: (status) => (status >= 200 && status < 300) || [301, 302, 303, 307, 308].includes(status),
            responseType: 'text',
          });
          break;
        } catch (error: any) {
          const retryable = !error?.response || error.response.status === 429 || error.response.status >= 500;
          if (!retryable || attempt === 1) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location || redirects === 3) throw new Error('Website redirect limit exceeded.');
        url = new URL(location, url);
        continue;
      }
      return { url, html: typeof response.data === 'string' ? response.data.slice(0, 500_000) : '' };
    }
    throw new Error('Website redirect limit exceeded.');
  }
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
   * Extract social media profile links (Facebook, Instagram, LinkedIn, Twitter/X, YouTube, TikTok, Pinterest) from website HTML.
   */
  static extractSocialMediaFromHtml(html: string): {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    twitter?: string;
    youtube?: string;
    tiktok?: string;
    pinterest?: string;
  } {
    if (!html || typeof html !== 'string') return {};

    const social: Record<string, string> = {};
    const ignored = new Set(['share', 'sharer', 'intent', 'login', 'signup', 'home', 'explore', 'search', 'p', 'reel', 'reels', 'stories', 'watch', 'shorts', 'playlist', 'embed', 'feed', 'about', 'help', 'legal', 'privacy', 'terms', 'events', 'plugins', 'dialog', 'accounts']);
    const candidates = new Set<string>();
    const hrefPattern = /\bhref\s*=\s*(["'])(.*?)\1/gi;
    for (const match of html.matchAll(hrefPattern)) candidates.add(match[2].replace(/&amp;/gi, '&').replace(/\\\//g, '/'));
    const urlPattern = /https?:\\?\/\\?\/(?:www\.)?(?:facebook\.com|fb\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|pinterest\.[a-z.]+)[^\s"'<>\\]*/gi;
    for (const match of html.matchAll(urlPattern)) candidates.add(match[0].replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/[,);}\]]+$/, ''));
    for (const candidate of candidates) {
      let url: URL;
      try { url = new URL(candidate); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part).toLowerCase());
      if (!segments.length || segments.some((part) => ignored.has(part)) || /\/sharing(?:\/|$)|share\.php/i.test(url.pathname + url.search)) continue;
      let platform: string | undefined;
      if (['facebook.com', 'fb.com'].includes(host) && (
        (segments[0] === 'pages' && segments.length >= 3) ||
        (segments[0] === 'profile.php' && /^\d+$/.test(url.searchParams.get('id') || '')) ||
        (segments[0] !== 'pages' && segments[0] !== 'profile.php' && /^[a-z0-9._-]+$/i.test(segments[0]))
      )) platform = 'facebook';
      else if (host === 'instagram.com' && /^[a-z0-9._]{2,30}$/i.test(segments[0])) platform = 'instagram';
      else if (host === 'linkedin.com' && ['company', 'in', 'school'].includes(segments[0]) && segments[1]) platform = 'linkedin';
      else if (['x.com', 'twitter.com'].includes(host) && /^[a-z0-9_]{1,20}$/i.test(segments[0])) platform = 'twitter';
      else if (host === 'youtube.com' && (segments[0]?.startsWith('@') || ['c', 'channel', 'user'].includes(segments[0]) && segments[1])) platform = 'youtube';
      else if (host === 'youtu.be' && segments[0]) platform = 'youtube';
      else if (host === 'tiktok.com' && /^@[a-z0-9_.-]{2,50}$/i.test(segments[0])) platform = 'tiktok';
      else if (/^pinterest\.[a-z.]+$/.test(host) && /^[a-z0-9_.-]{2,50}$/i.test(segments[0])) platform = 'pinterest';
      if (!platform || social[platform]) continue;
      url.protocol = 'https:';
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igshid)/i.test(key)) url.searchParams.delete(key);
      social[platform] = url.toString().replace(/\/$/, '');
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
    enrichmentStatus: 'COMPLETED' | 'PARTIAL' | 'NOT_FOUND' | 'FAILED';
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
      twitter?: string;
      youtube?: string;
      tiktok?: string;
      pinterest?: string;
    };
  }> {
    if (!websiteUrl || typeof websiteUrl !== 'string') {
      return { email: null, phone: null, enrichmentStatus: 'FAILED' };
    }

    try {
      let cleanUrl = websiteUrl.trim();
      if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = `https://${cleanUrl}`;
      const base = new URL(cleanUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return { email: null, phone: null, enrichmentStatus: 'FAILED' };
      const pendingPages = [base.toString()];
      const visited = new Set<string>();
      let email: string | null = null;
      let phone: string | null = null;
      let successfulPages = 0;
      const socialMedia: Record<string, string> = {};
      while (pendingPages.length && visited.size < 4) {
        const page = pendingPages.shift()!;
        if (visited.has(page)) continue;
        visited.add(page);
        if (visited.size > 1) await new Promise((resolve) => setTimeout(resolve, 150));
        let result: { url: URL; html: string };
        try { result = await this.getPublicHtml(page); } catch { continue; }
        if (!result.html) continue;
        successfulPages += 1;
        email ||= this.extractEmailFromText(result.html);
        phone ||= this.extractPhoneFromText(result.html);
        const found = this.extractSocialMediaFromHtml(result.html);
        for (const [platform, profile] of Object.entries(found)) if (!socialMedia[platform]) socialMedia[platform] = profile;
        const links = [...result.html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2].replace(/&amp;/gi, '&'));
        for (const href of links) {
          try {
            const target = new URL(href, result.url);
            if (target.origin !== result.url.origin || target.protocol !== result.url.protocol || visited.has(target.toString())) continue;
            if (/(?:contact|about|social|connect)/i.test(target.pathname) && !pendingPages.includes(target.toString())) pendingPages.push(target.toString());
          } catch { /* Ignore malformed page links. */ }
          if (visited.size + pendingPages.length >= 4) break;
        }
      }
      const profilesFound = Object.keys(socialMedia).length > 0;
      const enrichmentStatus = !successfulPages
        ? 'FAILED'
        : profilesFound
          ? (Object.keys(socialMedia).length >= 2 ? 'COMPLETED' : 'PARTIAL')
          : 'NOT_FOUND';
      return { email, phone, enrichmentStatus, socialMedia: profilesFound ? socialMedia : undefined };
    } catch {
      // Graceful fallback on network timeout, blocked crawler, or invalid SSL
      return { email: null, phone: null, enrichmentStatus: 'FAILED' };
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

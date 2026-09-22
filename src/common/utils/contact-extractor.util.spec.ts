import { ContactExtractor } from './contact-extractor.util';

describe('ContactExtractor Unit Tests', () => {
  describe('Phone Extraction & Normalization', () => {
    it('1. should normalize standard 10-digit Indian mobile number to +91XXXXXXXXXX', () => {
      expect(ContactExtractor.normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(ContactExtractor.normalizePhoneNumber('8123456789')).toBe('+918123456789');
      expect(ContactExtractor.normalizePhoneNumber('7012345678')).toBe('+917012345678');
      expect(ContactExtractor.normalizePhoneNumber('6987654321')).toBe('+916987654321');
    });

    it('2. should handle Indian number with leading 0 (09876543210)', () => {
      expect(ContactExtractor.normalizePhoneNumber('09876543210')).toBe('+919876543210');
    });

    it('3. should handle formatted Indian numbers (+91 98765 43210, +91-98765-43210, +91 (98765) 43210)', () => {
      expect(ContactExtractor.normalizePhoneNumber('+91 98765 43210')).toBe('+919876543210');
      expect(ContactExtractor.normalizePhoneNumber('+91-98765-43210')).toBe('+919876543210');
      expect(ContactExtractor.normalizePhoneNumber('+91 (98765) 43210')).toBe('+919876543210');
    });

    it('4. should handle tel: URLs (tel:+919876543210, tel:09876543210)', () => {
      expect(ContactExtractor.normalizePhoneNumber('tel:+919876543210')).toBe('+919876543210');
      expect(ContactExtractor.normalizePhoneNumber('tel:9876543210')).toBe('+919876543210');
      expect(ContactExtractor.normalizePhoneNumber('tel:+91-98765-43210?call')).toBe('+919876543210');
    });

    it('5. should handle international numbers (+1 415 555 2671, +44 20 7946 0958)', () => {
      expect(ContactExtractor.normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671');
      expect(ContactExtractor.normalizePhoneNumber('+44 20 7946 0958')).toBe('+442079460958');
    });

    it('6. should reject invalid phone numbers and placeholders', () => {
      expect(ContactExtractor.normalizePhoneNumber('')).toBeNull();
      expect(ContactExtractor.normalizePhoneNumber(null)).toBeNull();
      expect(ContactExtractor.normalizePhoneNumber(undefined)).toBeNull();
      expect(ContactExtractor.normalizePhoneNumber('N/A')).toBeNull();
      expect(ContactExtractor.normalizePhoneNumber('12345')).toBeNull();
      expect(ContactExtractor.normalizePhoneNumber('invalid-text')).toBeNull();
    });

    it('7. should extract phone from text labels and HTML', () => {
      expect(ContactExtractor.extractPhoneFromText('Phone: +91 9876543210')).toBe('+919876543210');
      expect(ContactExtractor.extractPhoneFromText('Call us at: 9876543210 for inquiries')).toBe('+919876543210');
      expect(ContactExtractor.extractPhoneFromText('<a href="tel:+919876543210">Contact Us</a>')).toBe('+919876543210');
      expect(ContactExtractor.extractPhoneFromText('{"@type": "LocalBusiness", "telephone": "+91 9876543210"}')).toBe('+919876543210');
    });
  });

  describe('Email Extraction & Normalization', () => {
    it('1. should normalize standard emails (trim, lowercase)', () => {
      expect(ContactExtractor.normalizeEmail(' Info@Company.in ')).toBe('info@company.in');
      expect(ContactExtractor.normalizeEmail('john.doe@business.org')).toBe('john.doe@business.org');
    });

    it('2. should strip mailto: and surrounding brackets/punctuation', () => {
      expect(ContactExtractor.normalizeEmail('mailto:contact@acme.com')).toBe('contact@acme.com');
      expect(ContactExtractor.normalizeEmail('mailto:sales@shop.com?subject=Hi')).toBe('sales@shop.com');
      expect(ContactExtractor.normalizeEmail('<support@domain.co.in>')).toBe('support@domain.co.in');
      expect(ContactExtractor.normalizeEmail('"ceo@agency.net"')).toBe('ceo@agency.net');
    });

    it('3. should reject placeholder emails and invalid formats', () => {
      expect(ContactExtractor.normalizeEmail('contact@company.com')).toBeNull();
      expect(ContactExtractor.normalizeEmail('placeholder@company.com')).toBeNull();
      expect(ContactExtractor.normalizeEmail('example@company.com')).toBeNull();
      expect(ContactExtractor.normalizeEmail('test@example.com')).toBeNull();
      expect(ContactExtractor.normalizeEmail('not-an-email')).toBeNull();
      expect(ContactExtractor.normalizeEmail('user@')).toBeNull();
      expect(ContactExtractor.normalizeEmail('')).toBeNull();
      expect(ContactExtractor.normalizeEmail(null)).toBeNull();
      expect(ContactExtractor.normalizeEmail('N/A')).toBeNull();
    });

    it('4. should extract email from HTML, JSON-LD, and text', () => {
      expect(ContactExtractor.extractEmailFromText('<a href="mailto:info@business.in">Email Us</a>')).toBe('info@business.in');
      expect(ContactExtractor.extractEmailFromText('{"@type": "Organization", "email": "sales@enterprise.com"}')).toBe('sales@enterprise.com');
      expect(ContactExtractor.extractEmailFromText('<meta name="email" content="helpdesk@service.org">')).toBe('helpdesk@service.org');
      expect(ContactExtractor.extractEmailFromText('Contact our team at support@cloudtech.in for details')).toBe('support@cloudtech.in');
    });
  });

  describe('Independence of Phone and Email', () => {
    it('should handle Phone Only (Email null)', () => {
      const phone = ContactExtractor.normalizePhoneNumber('9876543210');
      const email = ContactExtractor.normalizeEmail(undefined);
      expect(phone).toBe('+919876543210');
      expect(email).toBeNull();
    });

    it('should handle Email Only (Phone null)', () => {
      const phone = ContactExtractor.normalizePhoneNumber(null);
      const email = ContactExtractor.normalizeEmail('hello@startup.io');
      expect(phone).toBeNull();
      expect(email).toBe('hello@startup.io');
    });

    it('should handle Neither available (both null)', () => {
      const phone = ContactExtractor.normalizePhoneNumber('N/A');
      const email = ContactExtractor.normalizeEmail('contact@company.com'); // placeholder
      expect(phone).toBeNull();
      expect(email).toBeNull();
    });
  });
});

import { buildStageTemplateComponents, resolveTemplateVariableValue } from './whatsapp.util';

describe('Meta Template Validation & Parameter Mapping Regression Tests', () => {
  describe('resolveTemplateVariableValue', () => {
    const variables: Record<string, string> = {
      leadName: 'John Doe',
      customerName: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+919876543210',
      companyName: 'Acme Corp',
      stage: 'Lost / Lead Closed',
      userName: 'Jane Agent',
      assignedEmployeeName: 'Jane Agent',
      nextFollowUpDate: '25/11/2026',
      nextFollowUpTime: '10:00 AM',
    };

    it('resolves positional parameters (1, 2, 3, 4) with standard fallbacks', () => {
      expect(resolveTemplateVariableValue('1', 'body', variables)).toBe('John Doe');
      expect(resolveTemplateVariableValue('2', 'body', variables)).toBe('Acme Corp');
      expect(resolveTemplateVariableValue('3', 'body', variables)).toBe('Lost / Lead Closed');
      expect(resolveTemplateVariableValue('4', 'body', variables)).toBe('Jane Agent');
    });

    it('resolves named parameters regardless of casing or formatting', () => {
      expect(resolveTemplateVariableValue('customer_name', 'body', variables)).toBe('John Doe');
      expect(resolveTemplateVariableValue('company_name', 'body', variables)).toBe('Acme Corp');
      expect(resolveTemplateVariableValue('lead_name', 'body', variables)).toBe('John Doe');
      expect(resolveTemplateVariableValue('assigned_employee', 'body', variables)).toBe('Jane Agent');
      expect(resolveTemplateVariableValue('phone', 'body', variables)).toBe('+919876543210');
    });

    it('supports exact prefixed keys if provided', () => {
      const customVars = { ...variables, body_1: 'Custom Name', body_custom_tag: 'Special Value' };
      expect(resolveTemplateVariableValue('1', 'body', customVars)).toBe('Custom Name');
      expect(resolveTemplateVariableValue('custom_tag', 'body', customVars)).toBe('Special Value');
    });
  });

  describe('buildStageTemplateComponents', () => {
    const variables: Record<string, string> = {
      leadName: 'Rohan Sharma',
      customerName: 'Rohan Sharma',
      companyName: 'QuikBoom Agency',
      stage: 'Lost / Lead Closed',
      userName: 'Support Team',
    };

    it('handles approved template with consecutive underscores and positional parameters (lost___lead_closed)', () => {
      const definitions = [
        {
          type: 'BODY',
          text: 'Hi {{1}}, your inquiry for {{2}} has been marked as {{3}}. Contact {{4}} for assistance.',
        },
      ];

      const components = buildStageTemplateComponents(definitions, variables);
      expect(components).toHaveLength(1);
      expect(components[0].type).toBe('body');
      expect(components[0].parameters).toHaveLength(4);
      expect(components[0].parameters[0]).toEqual({ type: 'text', text: 'Rohan Sharma' });
      expect(components[0].parameters[1]).toEqual({ type: 'text', text: 'QuikBoom Agency' });
      expect(components[0].parameters[2]).toEqual({ type: 'text', text: 'Lost / Lead Closed' });
      expect(components[0].parameters[3]).toEqual({ type: 'text', text: 'Support Team' });
    });

    it('handles approved template with named parameters', () => {
      const definitions = [
        {
          type: 'BODY',
          text: 'Hello {{customer_name}}, thank you for contacting {{company_name}}.',
        },
      ];

      const components = buildStageTemplateComponents(definitions, variables);
      expect(components).toHaveLength(1);
      expect(components[0].type).toBe('body');
      expect(components[0].parameters).toHaveLength(2);
      expect(components[0].parameters[0]).toEqual({
        type: 'text',
        text: 'Rohan Sharma',
        parameter_name: 'customer_name',
      });
      expect(components[0].parameters[1]).toEqual({
        type: 'text',
        text: 'QuikBoom Agency',
        parameter_name: 'company_name',
      });
    });

    it.each(['IMAGE', 'VIDEO', 'DOCUMENT'])('uses the approved %s header format and a media URL', (format) => {
      const result = buildStageTemplateComponents([{ type: 'HEADER', format }], { header_media_url: 'https://cdn.example.com/media' });
      const type = format.toLowerCase();
      expect(result).toEqual([{ type: 'header', parameters: [{ type, [type]: { link: 'https://cdn.example.com/media' } }] }]);
    });

    it('supports WhatsApp media IDs and rejects missing or invalid references', () => {
      const definitions = [{ type: 'HEADER', format: 'IMAGE' }];
      expect(buildStageTemplateComponents(definitions, { header_media_id: '123456' })).toEqual([{ type: 'header', parameters: [{ type: 'image', image: { id: '123456' } }] }]);
      expect(() => buildStageTemplateComponents(definitions, {})).toThrow(/requires a valid HTTPS/);
      expect(() => buildStageTemplateComponents(definitions, { header_media_url: 'http://example.com/file' })).toThrow(/requires a valid HTTPS/);
      expect(() => buildStageTemplateComponents(definitions, { header_media_id: 'bad-id' })).toThrow(/media ID is invalid/);
    });

    it('keeps header and body parameters separate even when positional tags repeat', () => {
      const components = buildStageTemplateComponents([
        { type: 'HEADER', format: 'TEXT', text: 'Dear {{1}}' },
        { type: 'BODY', text: 'Hello {{1}}, welcome to {{2}}' },
      ], { header_1: 'Header Name', body_1: 'Body Name', body_2: 'Company' });
      expect(components).toEqual([
        { type: 'header', parameters: [{ type: 'text', text: 'Header Name' }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Body Name' }, { type: 'text', text: 'Company' }] },
      ]);
    });

    it('ensures static templates without variables produce no body parameters', () => {
      const staticDefinitions = [
        {
          type: 'BODY',
          text: 'Your lead status has been updated. Thank you for your interest.',
        },
      ];

      const components = buildStageTemplateComponents(staticDefinitions, variables);
      expect(components).toEqual([]);
    });

    it('gracefully handles missing parameters with safe text instead of throwing', () => {
      const emptyVars: Record<string, string> = {};
      const definitions = [
        {
          type: 'BODY',
          text: 'Hi {{1}}, status is {{2}}.',
        },
      ];

      expect(() => buildStageTemplateComponents(definitions, emptyVars)).not.toThrow();
      const components = buildStageTemplateComponents(definitions, emptyVars);
      expect(components[0].parameters[0].text).toBe('Valued Customer');
      expect(components[0].parameters[1].text).toBe('QUIKBOOM');
    });
  });
});

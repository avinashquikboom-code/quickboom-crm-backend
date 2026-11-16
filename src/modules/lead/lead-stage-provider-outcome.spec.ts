import { classifyMetaFailure, classifySmtpFailure } from './lead-stage-provider-outcome';

describe('structured provider outcomes', () => {
  it.each([
    [{ responseCode: 451, command: 'DATA' }, 'RETRYABLE_REJECTION'],
    [{ responseCode: 550, command: 'RCPT TO' }, 'DEFINITE_REJECTION'],
    [{ code: 'ECONNREFUSED', command: 'CONN' }, 'RETRYABLE_REJECTION'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'AMBIGUOUS'],
    [{ code: 'ECONNRESET' }, 'AMBIGUOUS'],
  ])('classifies SMTP facts without parsing messages', (error, expected) => {
    expect(classifySmtpFailure(error)).toBe(expected);
  });
  it.each([[429, 'RETRYABLE_REJECTION'], [400, 'DEFINITE_REJECTION'], [500, 'AMBIGUOUS'], [undefined, 'AMBIGUOUS']] as const)('classifies Meta HTTP %s', (status, expected) => {
    expect(classifyMetaFailure(status)).toBe(expected);
  });
});

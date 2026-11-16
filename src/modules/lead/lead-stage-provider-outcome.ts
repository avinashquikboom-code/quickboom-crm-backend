/** Only explicit provider/transport facts may authorize an automatic retry. */
export type StageProviderOutcome = 'RETRYABLE_REJECTION' | 'DEFINITE_REJECTION' | 'AMBIGUOUS';

export function classifySmtpFailure(error: any): StageProviderOutcome {
  const response = Number(error?.responseCode);
  // A response to the SMTP transaction proves the server rejected it.
  if (response >= 400 && response < 500) return 'RETRYABLE_REJECTION';
  if (response >= 500 && response < 600) return 'DEFINITE_REJECTION';
  // Connection setup failures before SMTP submission cannot have delivered mail.
  if (['CONN', 'CONNECT'].includes(String(error?.command || '').toUpperCase()) &&
      ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(error?.code || '').toUpperCase())) return 'RETRYABLE_REJECTION';
  return 'AMBIGUOUS';
}

export function classifyMetaFailure(httpStatus?: number): StageProviderOutcome {
  if (httpStatus === 429) return 'RETRYABLE_REJECTION';
  if (httpStatus != null && httpStatus >= 400 && httpStatus < 500) return 'DEFINITE_REJECTION';
  // A connection failure or server error may occur after acceptance.
  return 'AMBIGUOUS';
}

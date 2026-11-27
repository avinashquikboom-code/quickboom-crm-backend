/**
 * Turns an ElevenLabs SDK / axios error into a short, admin-actionable reason.
 * Never includes the API key or raw response headers.
 */
export function describeElevenLabsError(error: any): { status?: number; detail: string; reason: string } {
  const status: number | undefined = error?.statusCode ?? error?.response?.status;
  const body = error?.body ?? error?.response?.data;
  const rawDetail = body?.detail ?? body?.message ?? body;
  let detail = '';
  if (typeof rawDetail === 'string') detail = rawDetail;
  else if (Array.isArray(rawDetail)) detail = rawDetail.map((d: any) => d?.msg || d?.message || '').filter(Boolean).join('; ');
  else if (rawDetail && typeof rawDetail === 'object') detail = String(rawDetail.message || rawDetail.status || '');
  if (!detail) detail = String(error?.message || error?.name || 'Unknown error');
  detail = detail.slice(0, 300);

  let reason: string;
  if (status === 401) {
    reason = /permission|scope/i.test(detail)
      ? 'The ElevenLabs API key is missing a required permission. Edit the key at elevenlabs.io and enable Conversational AI / Speech Engine access.'
      : 'ElevenLabs rejected the API key. Check the key in Integrations.';
  } else if (status === 403) {
    reason = 'The ElevenLabs API key is not allowed to use this Speech Engine. Check key permissions and that the engine belongs to the same workspace.';
  } else if (status === 404) {
    reason = 'The Speech Engine ID was not found in this ElevenLabs account. Use the Speech Engine ID (seng_…), not a Voice ID.';
  } else if (status === 422 || status === 400) {
    reason = `ElevenLabs rejected the Speech Engine ID: ${detail}`;
  } else if (status === 429) {
    reason = 'ElevenLabs rate limit or quota reached. Try again shortly or check your plan usage.';
  } else if (!status) {
    reason = `Could not reach ElevenLabs: ${detail}`;
  } else {
    reason = `ElevenLabs error (${status}): ${detail}`;
  }
  return { status, detail, reason };
}

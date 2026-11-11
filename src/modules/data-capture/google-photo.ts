/** Pull a Places API (New) photo resource name out of a stored URL, proxy link, or photo reference. */
export function googlePhotoResource(value: string): string {
  let raw = String(value || '').trim();
  if (!raw || isPlaceholderPhoto(raw)) return '';
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded === raw) break;
      raw = decoded;
    } catch {
      break;
    }
  }
  const query = raw.match(/[?&]ref=([^&]+)/);
  if (query) return googlePhotoResource(query[1]);
  const match = raw.match(/places\/[^/?#]+\/photos\/[^/?#]+/);
  if (!match) return '';
  const name = match[0];
  const photoId = name.split('/').pop() || '';
  if (/^\d{1,3}$/.test(photoId)) return '';
  return name;
}

export function isPlaceholderPhoto(value: string): boolean {
  return /unsplash|pexels|placeholder|dummy|_sample|sample\d|default_avatar/i.test(value);
}

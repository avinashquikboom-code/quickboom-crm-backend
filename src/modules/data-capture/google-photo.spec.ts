import { googlePhotoResource, isPlaceholderPhoto } from './google-photo';

describe('google photo resources', () => {
  it('reads a photo resource encoded inside the proxy URL', () => {
    const resource = 'places/ChIJabc/photos/AelY_CuLongToken';
    const stored = `/api/v1/data-capture/photo?ref=${encodeURIComponent(resource)}`;
    expect(googlePhotoResource(stored)).toBe(resource);
  });

  it('rejects numbered placeholder photo names and stock image hosts', () => {
    expect(googlePhotoResource('places/photo/1')).toBe('');
    expect(isPlaceholderPhoto('https://images.unsplash.com/photo-1')).toBe(true);
    expect(googlePhotoResource('https://lh3.googleusercontent.com/p/AF1QipN_sample1')).toBe('');
  });
});
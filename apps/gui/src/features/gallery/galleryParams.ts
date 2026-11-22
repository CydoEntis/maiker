/** The hash that opens the gallery: `#gallery`, optionally `#gallery?theme=Paper`. */
export const GALLERY_HASH = '#gallery'

export function isGalleryHash(hash: string): boolean {
  return hash === GALLERY_HASH || hash.startsWith(`${GALLERY_HASH}?`)
}

/** The theme name the gallery hash asks for; an unknown theme is left to `findTheme`'s fallback. */
export function galleryParams(hash: string): { theme: string } {
  const query = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
  return { theme: query.get('theme') ?? 'Maiker Dark' }
}

export function galleryHash(theme: string): string {
  return `${GALLERY_HASH}?${new URLSearchParams({ theme }).toString()}`
}

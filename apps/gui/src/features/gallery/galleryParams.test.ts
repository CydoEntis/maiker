import { describe, expect, it } from 'vitest'
import { galleryHash, galleryParams, isGalleryHash } from './galleryParams'

describe('the gallery hash', () => {
  it('opens on #gallery alone or with a query, and on nothing else', () => {
    expect([isGalleryHash('#gallery'), isGalleryHash('#gallery?theme=Paper'), isGalleryHash('#galleryx'), isGalleryHash('')]).toEqual([true, true, false, false])
  })

  it('reads the theme it links to, falling back to Maiker Dark', () => {
    expect(galleryParams(galleryHash('Paper'))).toEqual({ theme: 'Paper' })
    expect(galleryParams('#gallery?corners=square')).toEqual({ theme: 'Maiker Dark' })
  })
})

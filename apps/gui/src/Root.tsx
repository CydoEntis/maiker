import { lazy, Suspense, useEffect } from 'react'
import { isDesktop } from '@/api/daemon'
import { installUndoRedo } from '@/features/editing/undoRedo'
import { DesktopApp } from '@/features/workspace/DesktopApp'
import { isGalleryHash } from '@/features/gallery/galleryParams'

// The galleries are their own chunks, for checking the shared components against the design: the desktop window never
// downloads or parses them.
const DialogsGallery = lazy(() => import('./features/gallery/DialogsGallery.tsx').then((module) => ({ default: module.DialogsGallery })))
const Gallery = lazy(() => import('./features/gallery/Gallery.tsx').then((module) => ({ default: module.Gallery })))

/**
 * The desktop window, or a gallery: `#dialogs`, `#gallery`, and the primitives gallery outside the desktop app (a
 * browser on `pnpm dev`), where there is no daemon to show.
 */
export function Root() {
  // Here and not in the window: the galleries' text fields take the same undo and redo.
  useEffect(() => installUndoRedo(document, navigator.userAgent), [])
  if (window.location.hash.startsWith('#dialogs')) return <Suspense fallback={null}><DialogsGallery /></Suspense>
  if (isGalleryHash(window.location.hash) || !isDesktop()) return <Suspense fallback={null}><Gallery /></Suspense>
  return <DesktopApp />
}

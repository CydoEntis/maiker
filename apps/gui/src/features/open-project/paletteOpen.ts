/** Marks the Open a project palette's frame, so the window can tell it is up without holding its state. */
export const OPEN_PALETTE_ATTRIBUTE = 'data-open-project-palette'

/**
 * Whether the Open a project palette is on screen, in either mode and wherever it was opened from (the window, the New
 * session draft, Settings). While it is, every key is its own: the window's shortcuts and its Esc ladder stand down.
 */
export function isOpenPaletteUp(): boolean {
  return document.querySelector(`[${OPEN_PALETTE_ATTRIBUTE}]`) !== null
}

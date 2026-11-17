/** Where the theme's ground is kept for `public/boot-ground.js`, which paints it before the app's code loads. */
export const GROUND_KEY = 'maitty.gui.ground.v1'

const HEX_COLOUR = /^#[0-9a-fA-F]{3,8}$/

/**
 * Paints `ground` behind the whole page and keeps it for the next start, so the window opens on this theme's colour
 * instead of a flash of white or of the default theme. Only a hex colour is kept: it is what the boot script accepts.
 */
export function rememberGround(ground: string): void {
  if (!HEX_COLOUR.test(ground)) return
  document.documentElement.style.backgroundColor = ground
  try {
    localStorage.setItem(GROUND_KEY, ground)
  } catch (error) {
    // Blocked storage only costs the next start its colour; the window is painted already.
    console.warn('Could not keep the theme colour for the next start', error)
  }
}

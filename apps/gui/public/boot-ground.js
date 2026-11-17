/* global window, document */
// Runs before the app's code loads: paints the ground of the theme the window last showed, so starting the app never
// flashes white or the default theme's colour. Written by `rememberGround` (src/data/bootGround.ts); the key and the
// colour check must match it. Kept out of the page itself because the content security policy allows no inline script.
try {
  var ground = window.localStorage.getItem('maitty.gui.ground.v1')
  if (ground !== null && /^#[0-9a-fA-F]{3,8}$/.test(ground)) document.documentElement.style.backgroundColor = ground
} catch {
  // Blocked storage: the page keeps the default ground it is written with.
}

/**
 * Whether nothing on the page has the keys, so a part that opens may take them. The web view goes on naming a field as the
 * focused element for a moment after it was taken off the page or turned off (it moves the focus away at its next
 * frame), so such a field counts as nothing too: the New session draft's box, removed in the update that opens the
 * started chat, must not keep that chat's box from taking the keys.
 */
export function keysAreNowhere(active: Element | null = document.activeElement): boolean {
  if (active === null || active === document.body || !active.isConnected) return true
  return (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active instanceof HTMLButtonElement) && active.disabled
}

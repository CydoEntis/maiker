/** The most bytes a folder name may take: what the common file systems allow. The daemon applies the same rule. */
export const FOLDER_NAME_MAX_BYTES = 255

/** Names Windows keeps for devices, with or without an extension after them. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Why `name` cannot be a new folder's name, in words to show under the field, or null when it can. One rule for every
 * system (the strictest applies everywhere), mirroring the daemon's, which checks again. `taken` are the names already in
 * the folder; names compare without regard to case, as Windows and macOS see them.
 */
export function folderNameProblem(name: string, taken: readonly string[]): string | null {
  const stem = name.split('.')[0]?.trimEnd() ?? ''
  if (name === '') return 'Type a name for the folder.'
  if (new TextEncoder().encode(name).length > FOLDER_NAME_MAX_BYTES) return 'That name is too long.'
  if (name === '.' || name === '..') return 'A folder cannot be called . or ..'
  if (/[/\\]/.test(name)) return 'A name cannot hold / or \\: it is one folder, not a path.'
  if (/[<>:"|?*]/.test(name)) return 'A name cannot hold any of < > : " | ? *'
  // eslint-disable-next-line no-control-regex -- the point is to refuse control characters
  if (/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(name)) return 'A name cannot hold control or hidden characters.'
  if (name.startsWith(' ') || name.endsWith(' ') || name.endsWith('.')) return 'A name cannot start or end with a space, or end with a dot.'
  if (DEVICE_NAME.test(stem)) return 'Windows keeps that name for a device. Pick another.'
  const lower = name.toLowerCase()
  if (taken.some((other) => other.toLowerCase() === lower)) return `A folder called ${name} is already here.`
  return null
}

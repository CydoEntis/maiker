const DRIVE = /^[A-Za-z]:$/

/** The folder a project folder sits in, where a clone goes beside it by default; '' for none. */
export function parentFolder(folder: string): string {
  const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
  if (cut === -1) return ''
  const head = folder.slice(0, cut)
  // A folder at the top keeps its root: `/` on Unix, `C:\` on Windows.
  return head === '' || DRIVE.test(head) ? folder.slice(0, cut + 1) : head
}

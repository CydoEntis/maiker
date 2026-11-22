import type { SessionPermissions } from '@/api/daemon'

const STORAGE_KEY = 'maiker.gui.permissions.v1'

function isPermissions(value: unknown): value is SessionPermissions {
  return (
    value === 'read-only' ||
    value === 'workspace-write' ||
    value === 'full-access'
  )
}

export function readConversationPermissions(): Record<
  string,
  SessionPermissions
> {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === null) return {}
  try {
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, SessionPermissions] =>
          isPermissions(entry[1]),
      ),
    )
  } catch {
    console.warn('Ignoring invalid Maiker session permissions')
    return {}
  }
}

export function rememberConversationPermissions(
  conversationId: string,
  permissions: SessionPermissions,
): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...readConversationPermissions(),
      [conversationId]: permissions,
    }),
  )
}

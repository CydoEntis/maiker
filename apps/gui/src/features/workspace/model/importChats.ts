import { useEffect, useState } from 'react'
import { importableChats, type ImportableChat } from '@/api/daemon'
import type { NewChatRequest } from '../components/NewChatPage'
import { baseName } from './folderPick'
import { savedName } from './newChatHost'
import { savedStart } from './recentSessions'

/** A chat used this recently may still be open in another terminal: it is offered unticked, with a word about it. */
export const OPEN_ELSEWHERE_SECONDS = 120
/** Chats used within this long (a week) are ticked to start with; older ones are listed but left for the person to pick. */
export const RECENT_SECONDS = 604_800

/** One project's chats, newest first, under the folder's name. */
export type ImportGroup = { readonly folder: string; readonly name: string; readonly chats: readonly ImportableChat[] }

export type ImportRead = { kind: 'loading' } | { kind: 'listed'; list: readonly ImportableChat[] } | { kind: 'older' } | { kind: 'failed' }

/** The key a chat is ticked by: its agent's own id is only unique within that agent. */
export function importKey(chat: ImportableChat): string {
  return `${chat.agent}:${chat.saved.id}`
}

/** Whether `chat` was written to so lately that its agent may still be running it elsewhere. */
export function maybeOpenElsewhere(chat: ImportableChat, now: number): boolean {
  return now - chat.saved.last_active < OPEN_ELSEWHERE_SECONDS
}

/** The start that brings `chat` in: under the name its agent gave it, aged from when it was last used. */
export function importStart(chat: ImportableChat): NewChatRequest {
  return savedStart(chat.folder, chat.agent, chat.saved.id, { name: savedName(chat.saved), lastActive: chat.saved.last_active })
}

/** The chats ticked when the list opens: the recent ones, but none that may still be open elsewhere. */
export function tickedAtFirst(chats: readonly ImportableChat[], now: number): ReadonlySet<string> {
  return new Set(chats.filter((chat) => now - chat.saved.last_active < RECENT_SECONDS && !maybeOpenElsewhere(chat, now)).map(importKey))
}

/** The chats by project, the project used last first; each keeps the newest-first order it came in. */
export function groupByFolder(chats: readonly ImportableChat[]): readonly ImportGroup[] {
  const groups = new Map<string, ImportableChat[]>()
  for (const chat of chats) {
    const group = groups.get(chat.folder)
    if (group === undefined) groups.set(chat.folder, [chat])
    else group.push(chat)
  }
  return [...groups].map(([folder, list]) => ({ folder, name: baseName(folder), chats: list }))
}

/** The chats to import, read once off the UI thread when the list opens. */
export function useImportableChats(): ImportRead {
  const [read, setRead] = useState<ImportRead>({ kind: 'loading' })
  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      try {
        const list = await importableChats()
        if (!stop.signal.aborted) setRead(list === null ? { kind: 'older' } : { kind: 'listed', list })
      } catch (error) {
        if (!stop.signal.aborted) setRead({ kind: 'failed' })
        console.warn('Could not read the chats to import', error)
      }
    })()
    return () => { stop.abort() }
  }, [])
  return read
}

import { useState } from 'react'
import type { ImportableChat } from '@/api/daemon'
import { useImportableChats } from '../model/importChats'
import { nowSeconds } from '../model/newChatHost'
import { ImportChatsDialog } from './ImportChatsDialog'

/** Bring in your chats, reading the list once as it opens. */
export function ImportChats({ locked, onImport, onCancel }: { locked: boolean; onImport: (chats: readonly ImportableChat[]) => void; onCancel: () => void }) {
  const read = useImportableChats()
  const [now] = useState(nowSeconds)
  return <ImportChatsDialog read={read} now={now} locked={locked} onImport={onImport} onCancel={onCancel} />
}

import { useRef, useState } from 'react'
import type { ImportableChat } from '@/api/daemon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { groupByFolder, importKey, maybeOpenElsewhere, tickedAtFirst, type ImportRead } from '../model/importChats'
import { ageOf, savedName, whenOf } from '../model/newChatHost'
import { AppIcon } from './glyphs'
import { windowRoot } from './windowRoot'

const TITLE = 'Bring in your chats'

type Props = {
  read: ImportRead
  /** When the list was opened (unix seconds): ages and the open-elsewhere mark count from it. */
  now: number
  /** A start is under way, so an import would be refused. */
  locked: boolean
  onImport: (chats: readonly ImportableChat[]) => void
  onCancel: () => void
}

/**
 * The chats Claude and Codex saved on this computer that Maiker does not run yet, by project, the recent ones ticked.
 * Import opens each ticked one as a Maiker chat with its history. One written to a moment ago may still be open in
 * another terminal, so it starts unticked and says to close it there first: two copies would write to one file.
 */
export function ImportChatsDialog(props: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label={TITLE}
          className="mx-rename mx-modal mx-recent mx-import"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title={TITLE} onClose={props.onCancel} />
          {props.read.kind === 'listed' && props.read.list.length > 0
            ? <ImportList {...props} list={props.read.list} />
            : (
                <>
                  <ModalBody><p role="status">{statusWords(props.read)}</p></ModalBody>
                  <ModalFoot><Button type="button" variant="ghost" size="lg" onClick={props.onCancel}>Close</Button></ModalFoot>
                </>
              )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function statusWords(read: ImportRead): string {
  if (read.kind === 'loading') return 'Looking for chats on this computer…'
  if (read.kind === 'failed') return 'Could not read the chats on this computer.'
  if (read.kind === 'older') return 'Restart the Maiker service to look for chats to bring in.'
  return 'No Claude or Codex chat on this computer to bring in. Every one is already here.'
}

function ImportList({ list, now, locked, onImport, onCancel }: Props & { list: readonly ImportableChat[] }) {
  const [ticked, setTicked] = useState(() => tickedAtFirst(list, now))
  const toggle = (key: string) => {
    setTicked((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const chosen = list.filter((chat) => ticked.has(importKey(chat)))
  return (
    <>
      <ModalBody>
        <p>Chats you had with Claude or Codex on this computer. Each one you tick opens here with its history, in its own project.</p>
        <div className="mx-import-groups">
          {groupByFolder(list).map((group) => (
            <section key={group.folder} className="mx-import-group" aria-label={group.name}>
              <h3 className="mx-import-folder" title={group.folder}>{group.name}</h3>
              <ul className="mx-cutoff-list">
                {group.chats.map((chat) => {
                  const key = importKey(chat)
                  const elsewhere = maybeOpenElsewhere(chat, now)
                  return (
                    <li key={key}>
                      <label className="mx-cutoff-row" title={savedName(chat.saved)}>
                        <input type="checkbox" data-bare checked={ticked.has(key)} onChange={() => { toggle(key) }} />
                        <AppIcon process={chat.agent} size={14} />
                        <span className="mx-cutoff-name">{savedName(chat.saved)}</span>
                        {elsewhere && <span className="mx-cutoff-where">May be open elsewhere: close it there first</span>}
                        <span className="mx-cutoff-when">{whenOf(chat.saved.last_active, now)} · {ageOf(chat.saved.last_active, now)}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </ModalBody>
      <ModalFoot left={<Button type="button" variant="ghost" size="lg" onClick={onCancel}>Not now</Button>}>
        <Button type="button" variant="primary" size="lg" disabled={chosen.length === 0 || locked} onClick={() => { onImport(chosen) }}>
          {chosen.length === 1 ? 'Bring in 1 chat' : `Bring in ${String(chosen.length)} chats`}
        </Button>
      </ModalFoot>
    </>
  )
}

import { useMemo, useState } from 'react'
import '@/features/chat/chat.css'
import { ChatActionsContext, type ChatActions } from '@/features/chat/chatActions'
import type { DraftQuote } from '@/features/chat/composerStore'
import { ChatItem, type ChatItemContext } from '@/features/chat/components/ChatItems'
import { QuoteStrip } from '@/features/chat/components/QuoteStubs'
import { ReplyTray } from '@/features/chat/components/ReplyTray'
import { askablesOf } from '@/features/chat/plainQuestions'
import { buildQuoteMessage } from '@/features/chat/quoteMessage'
import { keepReplyDraft } from '@/features/chat/quickReply'
import type { ChatRow } from '@/features/chat/chatRows'
import { messageEvent } from '@/features/chat/eventFixtures'

/** Replies and quotes as the chat draws them, built from the real rows and trays (docs/DESIGN.md, "Replies and quotes"). */

const ASKED = 'Before I start, a few questions:\n\n1. Which branch should this target?\n2. Should I keep the old endpoint?\n3. Any naming preference?\n4. Do you want the migration in this change or a separate one?\n5. When the old endpoint is finally removed, should the mobile team get a deprecation notice first, and how long should the overlap with the new orders endpoint last before it goes?'
const NOTHING = () => undefined
const ITEM: ChatItemContext = { agent: 'claude', workingSince: null, root: null, openDiff: NOTHING, goToStep: null, waitingStep: null }
const ACTIONS: ChatActions = { quote: NOTHING, jump: NOTHING, reply: NOTHING, retry: NOTHING, canReply: true }
const asked = askablesOf(ASKED)
const REPLY = buildQuoteMessage([
  { kind: 'quote', who: 'Claude', text: '1. Which branch should this target?' },
  { kind: 'words', text: 'main' },
  { kind: 'quote', who: 'Claude', text: '2. Should I keep the old endpoint?' },
  { kind: 'words', text: 'Yes, until the mobile app moves over.' },
])
const QUOTES: readonly DraftQuote[] = [
  { id: 'q1', who: 'Claude', text: 'The lockfile was out of date, so I regenerated it and ran the install again.' },
  { id: 'q2', who: 'You', text: 'Please keep the old endpoint working until the mobile app has moved.' },
  { id: 'q3', who: 'Claude', text: '3. Any naming preference?' },
]
const FILLED = { 'Which branch should this target?': 'main', 'Should I keep the old endpoint?': 'Yes' }

const ROWS: ChatRow[] = [
  { kind: 'user', key: 'u1', event: messageEvent('u1', 'user', 'Add a v2 for the orders endpoint.') },
  { kind: 'agent', key: 'a1', turnId: 't1', status: 'completed', paragraphs: ASKED.split('\n\n') },
  { kind: 'user', key: 'u2', event: messageEvent('u2', 'user', REPLY) },
]

/** The tray with its answers already written, kept under its own message so the gallery shows it filled. */
function Filled() {
  useMemo(() => { keepReplyDraft('gallery-filled', FILLED) }, [])
  return <ReplyTray who="Claude" asked={asked} focus={null} message="gallery-filled" blocked={null} onSend={() => Promise.resolve(true)} onClose={NOTHING} autoFocus={false} />
}

/** One state of the tray in a column the width of the message box, so its footprint is what the chat gives it. */
function Slot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="m-0 flex flex-col gap-2" data-replies={label}>
      <figcaption className="text-xs text-(--muted)">{label}</figcaption>
      <div className="mx-composer-column" style={{ maxWidth: 'none' }}>{children}</div>
    </figure>
  )
}

export function RepliesGallery({ width }: { width: number }) {
  const [quotes, setQuotes] = useState(QUOTES)
  return (
    <div className="flex flex-col gap-6" style={{ width }} data-replies-root={width}>
      <ChatActionsContext.Provider value={ACTIONS}>
        <div className="mx-chat" style={{ zoom: 1 }}>
          <div className="mx-chat-scroller flex flex-col">{ROWS.map((row) => <ChatItem key={row.key} row={row} {...ITEM} />)}</div>
        </div>
      </ChatActionsContext.Provider>
      <Slot label="Quote strip above the message box"><QuoteStrip quotes={quotes} onRemove={(id) => { setQuotes((now) => now.filter((one) => one.id !== id)) }} onClear={() => { setQuotes([]) }} /></Slot>
      <Slot label="Reply tray, every question"><ReplyTray who="Claude" asked={asked} focus={null} message="gallery-empty" blocked={null} onSend={() => Promise.resolve(true)} onClose={NOTHING} autoFocus={false} /></Slot>
      <Slot label="Reply tray, answers written"><Filled /></Slot>
      <Slot label="Reply tray, opened from one question"><ReplyTray who="Claude" asked={asked} focus={asked[2]?.key ?? null} message="gallery-one" blocked={null} onSend={() => Promise.resolve(true)} onClose={NOTHING} autoFocus={false} /></Slot>
    </div>
  )
}

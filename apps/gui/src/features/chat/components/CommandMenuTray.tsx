import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { KEY_ESCAPE } from '../terminalKeys'
import { TerminalPrompt } from './TerminalPrompt'
import { WaitingCard } from './WaitingCard'

type Props = {
  /** The agent's name, and so the card's. */
  agent: string
  /** What the command the person ran is for ("model"). */
  topic: string
  readScreen: (() => Promise<string>) | undefined
  sendKeys: (keys: string) => Promise<void>
  onClose: () => void
}

/**
 * A menu one of the agent's own commands opened in its terminal (Codex's `/model`), drawn in the chat: the menu as the
 * terminal shows it and the keys a person would press. Nothing is chosen for the person and nothing is read from the
 * screen as a fact about the agent; closing it types Esc, which is what leaves the menu in the terminal too.
 */
export function CommandMenuTray({ agent, topic, readScreen, sendKeys, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const close = () => {
    setBusy(true)
    sendKeys(KEY_ESCAPE)
      .catch((error: unknown) => { toast.failed('Could not close the menu', error) })
      .finally(() => { setBusy(false); onClose() })
  }
  return (
    <WaitingCard
      label={`${agent} ${topic} menu`}
      title={`${agent}'s ${topic} menu`}
      aside="From its terminal"
      flush
      foot={<Button variant="soft" disabled={busy} title="Esc in the terminal: leaves the menu" onClick={close}>Close</Button>}
    >
      <TerminalPrompt readScreen={readScreen} sendKeys={sendKeys} />
    </WaitingCard>
  )
}

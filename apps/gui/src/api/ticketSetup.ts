import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { z } from 'zod'

/** The longest suggested link shown; the daemon cuts it to this too (`TICKET_SETUP_LINK_MAX_CHARS`). */
const LINK_MAX_CHARS = 512

/** The longest folder the daemon sends (`TICKET_LINK_FOLDER_MAX_CHARS`). */
const FOLDER_MAX_CHARS = 1024

const AskSchema = z.object({
  term: z.number().int().nonnegative(),
  folder: z.string().max(FOLDER_MAX_CHARS),
  source: z.enum(['GitHub', 'Plane', 'Linear']).nullish(),
  link: z.string().max(LINK_MAX_CHARS).default(''),
})

/** Which source the setup opens on, in the window's words. */
export type SetupSource = 'github' | 'plane' | 'linear'

/**
 * An agent asked for its project's ticket setup (`ServerMsg::TicketSetup`): the pane it runs in, its project's folder,
 * the source to open on and a link it suggests. All of it is the agent's words: the link is plain text, shown and never
 * opened or saved on its own, and nothing is set up until you press a button.
 */
export type TicketSetupAsk = { term: number; folder: string; source: SetupSource | null; link: string }

const SOURCE: Readonly<Record<'GitHub' | 'Plane' | 'Linear', SetupSource>> = { GitHub: 'github', Plane: 'plane', Linear: 'linear' }

/** Calls back each time an agent of this computer asks for its project's ticket setup. Never outside the desktop app. */
export function listenTicketSetup(onAsk: (ask: TicketSetupAsk) => void): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => undefined)
  return listen<unknown>('ticket-setup', (event) => {
    const ask = AskSchema.safeParse(event.payload)
    if (!ask.success) return
    // One line with no spaces, as the daemon sent it; anything else is not offered.
    const link = /^\S*$/.test(ask.data.link) ? ask.data.link : ''
    onAsk({ term: ask.data.term, folder: ask.data.folder, source: ask.data.source == null ? null : SOURCE[ask.data.source], link })
  })
}

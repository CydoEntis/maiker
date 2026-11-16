import { useEffect, useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { listenTicketSetup, type SetupSource, type TicketSetupAsk } from '@/api/ticketSetup'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'

/** What an agent's ask leaves with the Tickets page: the source to open on and the link it suggests. */
export type SetupAsk = { source: SetupSource | null; link: string }

type Session = { id: string; pane: number; machine: number; ended?: boolean }

type Options = {
  sessions: readonly Session[]
  ticketsOpen: boolean
  showSessionById: (id: string) => void
  setInspectOpen: (open: boolean) => void
  setTicketsOpen: (open: boolean) => void
}

/**
 * An agent of this computer asked for its project's ticket setup (`<app>_tickets_setup`): bring its chat to the front
 * and open Tickets on it, on the source it named, with its link suggested. Nothing is saved here; you finish the setup.
 * The ask goes when Tickets closes.
 */
export function useTicketSetupAsks({ sessions, ticketsOpen, showSessionById, setInspectOpen, setTicketsOpen }: Options): SetupAsk | null {
  const [ask, setAsk] = useState<SetupAsk | null>(null)
  const onAsk = useLatest((asked: TicketSetupAsk) => {
    const session = sessions.find((each) => each.machine === LOCAL_MACHINE && each.pane === asked.term && each.ended !== true)
    if (session === undefined) return
    showSessionById(session.id)
    setInspectOpen(false)
    setAsk({ source: asked.source, link: asked.link })
    setTicketsOpen(true)
    toast.message('Your agent opened the ticket setup. Finish it here: keys go only in Maitty, never in the chat.')
  })
  useEffect(() => {
    let stop: (() => void) | null = null
    let gone = false
    void listenTicketSetup(onAsk).then((unlisten) => { if (gone) unlisten(); else stop = unlisten }, () => undefined)
    return () => { gone = true; stop?.() }
  }, [onAsk])
  // The ask goes when Tickets closes, so the next opening is your own.
  const [wasOpen, setWasOpen] = useState(ticketsOpen)
  if (ticketsOpen !== wasOpen) {
    setWasOpen(ticketsOpen)
    if (!ticketsOpen) setAsk(null)
  }
  return ask
}

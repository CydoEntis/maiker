import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { IconButton } from '@/components/ui/button'
import { DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/features/workspace/components/glyphs'

type Props = {
  title: string
  /** The machine's address, in mono beside the title. */
  address?: string | null
  children: ReactNode
}

/** The Add a remote machine card: a header (server mark, title, address, close), then a body and a foot. The card is as tall as what it holds. */
export function AddMachineFrame({ title, address = null, children }: Props) {
  return (
    <>
      <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-(--line) pr-3 pl-5">
        <span aria-hidden="true" className="grid size-[26px] flex-none place-items-center rounded-(--r-control) bg-[color-mix(in_oklab,var(--link)_12%,transparent)] text-(--link)"><Icon name="server" size={15} /></span>
        <DialogTitle asChild><h2 className="m-0 text-[15px] font-semibold text-(--fg)">{title}</h2></DialogTitle>
        {address !== null && <span className="min-w-0 truncate font-(family-name:--mono) text-xs text-(--dim)">{address}</span>}
        <DialogClose asChild><IconButton label="Close" className="ml-auto"><XIcon /></IconButton></DialogClose>
      </header>
      {children}
    </>
  )
}

/** The scrolling part of the card. */
export function FrameBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-5">{children}</div>
}

/** The foot: the way back at the left, the answers at the right. */
export function FrameFoot({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <footer className="flex flex-none items-center gap-2 border-t border-(--line) px-4 pt-3 pb-3.5">
      {start}
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </footer>
  )
}

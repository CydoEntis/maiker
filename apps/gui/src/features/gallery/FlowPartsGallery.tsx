import { useState } from 'react'
import { ChoiceCards } from '@/components/ui/choice-cards'
import { Progress } from '@/components/ui/progress'

/** The parts the first-run setup is built from, in the states it reaches. */

const VIEWS = [
  { value: 'chat', title: 'Chat', detail: 'Readable replies and diffs.', recommended: true },
  { value: 'terminal', title: 'Terminal', detail: 'The agent as it draws itself.' },
]

function Titled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-(family-name:--mono) text-[11px] font-medium text-(--dim)">{label}</span>
      {children}
    </div>
  )
}

export function FlowPartsGallery() {
  const [view, setView] = useState<string | null>('chat')
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-6">
      <Titled label="Progress · percent, unknown length">
        <Progress value={65} label="Percent" />
        <Progress label="Unknown length" />
      </Titled>
      <div className="col-span-full flex flex-col gap-6">
        <Titled label="ChoiceCards · Recommended tag">
          <ChoiceCards label="Your view" cards={VIEWS} value={view} onValueChange={setView} />
        </Titled>
      </div>
    </div>
  )
}

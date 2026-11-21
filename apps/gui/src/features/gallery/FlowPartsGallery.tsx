import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChoiceCards } from '@/components/ui/choice-cards'
import { Progress } from '@/components/ui/progress'
import { StepBar } from '@/components/ui/step-bar'
import { Steps, type StepItem } from '@/components/ui/steps'

/** The parts the add-machine checklist and the first-run setup are built from, in the states those flows reach. */

const SAMPLE_STEP = 2
const ONBOARDING_STEPS = ['Welcome', 'Agents', 'Your style', 'Your view', 'Review']

const CHECKLIST: StepItem[] = [
  { id: 'reach', label: 'Reach the computer', state: 'done', result: 'Reached 100.78.214.15 · 38 ms' },
  {
    id: 'key',
    label: 'Sign in with your key',
    state: 'needs',
    result: 'server-15 did not accept your key.',
    body: <div className="flex flex-wrap gap-1.5"><Button variant="needs" size="sm">Copy my key to server-15</Button><Button variant="soft" size="sm">Copy the command</Button></div>,
  },
  { id: 'helper', label: 'Set up the Maiker helper', state: 'pending' },
  { id: 'connected', label: 'Connected', state: 'pending' },
]

const INSTALLING: StepItem[] = [
  { id: 'reach', label: 'Reach the computer', state: 'done', result: 'Reached homelab · 12 ms' },
  { id: 'helper', label: 'Set up the Maiker helper', state: 'running', result: 'Not installed yet. Copying Maiker 0.46.0 to homelab…', body: <Progress value={45} label="Copying the helper" /> },
  { id: 'connected', label: 'Connected', state: 'pending' },
]

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
  const [step, setStep] = useState(SAMPLE_STEP)
  const [view, setView] = useState<string | null>('chat')
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-6">
      <Titled label="Steps · needs you"><Steps label="Adding server-15" steps={CHECKLIST} /></Titled>
      <Titled label="Steps · running with a progress bar"><Steps label="Adding homelab" steps={INSTALLING} /></Titled>
      <Titled label="Progress · percent, unknown length">
        <Progress value={65} label="Percent" />
        <Progress label="Unknown length" />
      </Titled>
      <div className="col-span-full flex flex-col gap-6">
        <Titled label="StepBar · click a finished step to go back">
          <StepBar steps={ONBOARDING_STEPS} current={step} onSelect={setStep} skip={{ label: 'Skip setup', onSkip: () => { setStep(0) } }} />
        </Titled>
        <Titled label="ChoiceCards · Recommended tag">
          <ChoiceCards label="Your view" cards={VIEWS} value={view} onValueChange={setView} />
        </Titled>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Steps, type StepItem, type StepState } from '@/components/ui/steps'

const STEP_IDS = ['reach', 'host', 'key', 'helper', 'connected'] as const
export type StepId = (typeof STEP_IDS)[number]

/** Where the checklist stands: the step in hand, how it is, and (for a step that needs the person) the one fix. */
export type Position = {
  at: StepId
  state: StepState
  /** Replaces the step's name while it is in hand ("server-15 didn't accept your key"). */
  label?: string
  body?: ReactNode
}

const NAMES: Record<StepId, (host: string, user: string | null) => string> = {
  reach: (host) => `Reach ${host}`,
  host: () => "Check it's the right computer",
  key: (_host, user) => (user === null ? 'Sign in with your SSH key' : `Sign in as ${user} with your SSH key`),
  helper: () => 'Set up the Maiker helper',
  connected: () => 'Connected',
}

type Props = {
  /** What is being reached, for the first step's name. */
  host: string
  /** The login name, for the sign-in step's name. */
  user?: string | null
  position: Position
  /** What each step came to, shown once it is done ("Known computer"). */
  results: Partial<Record<StepId, string>>
}

/**
 * The checklist Add a remote machine (and Fix) runs in place: Reach, Check it's the right computer, Sign in with your key,
 * Set up the Maiker helper, Connected. Everything before the step in hand is ticked with its result; everything after waits.
 */
export function AddChecklist({ host, user = null, position, results }: Props) {
  const current = STEP_IDS.indexOf(position.at)
  const steps: StepItem[] = STEP_IDS.map((id, index) => {
    const state: StepState = index < current ? 'done' : index === current ? position.state : 'pending'
    const item: StepItem = { id, label: index === current && position.label !== undefined ? position.label : NAMES[id](host, user), state }
    const result = results[id]
    if (state === 'done' && result !== undefined) item.result = result
    if (index === current && position.body !== undefined) item.body = position.body
    return item
  })
  return <Steps steps={steps} label="Steps to connect" />
}

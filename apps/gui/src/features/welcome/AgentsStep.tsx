import type { ReactNode, Ref } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardList } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatusIcon } from '@/components/ui/status-icon'
import { StepHead } from './StepHead'
import { SETUP_AGENTS } from './setup'
import type { InstallState } from './useAgentInstalls'

type Agent = (typeof SETUP_AGENTS)[number]

type Actions = {
  ask: (agents: readonly string[]) => void
  run: (agents: readonly string[]) => void
  cancel: (agent: string) => void
}

/** What an agent's row says under its name: its version when known, and what it is. */
const describe = (agent: Agent, version: string | null | undefined): string => (version ? `v${version.replace(/^v/, '')} · ${agent.detail}` : agent.detail)

function AskBody({ agent, state, actions }: { agent: Agent; state: Extract<InstallState, { phase: 'asking' }>; actions: Actions }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-xs text-(--fg2)">{state.command === null ? 'Looking up the command…' : 'Installing runs this command:'}</span>
      {state.command !== null && <code className="block overflow-x-auto bg-(--well) px-2.5 py-1.5 font-(family-name:--mono) text-xs whitespace-pre text-(--fg) shadow-[inset_0_0_0_1px_var(--line)]">{state.command}</code>}
      <div className="flex gap-2">
        <Button size="sm" disabled={state.command === null} onClick={() => { actions.run([agent.program]) }}>Run it</Button>
        <Button size="sm" variant="ghost" onClick={() => { actions.cancel(agent.program) }}>Cancel</Button>
      </div>
    </div>
  )
}

function RunningBody({ agent, state }: { agent: Agent; state: Extract<InstallState, { phase: 'running' }> }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Progress label={`Installing ${agent.label}`} {...(state.percent === null ? {} : { value: state.percent })} />
      {state.line !== '' && <span className="truncate font-(family-name:--mono) text-[11px] text-(--dim)">{state.line}</span>}
    </div>
  )
}

function FailedBody({ agent, state, actions }: { agent: Agent; state: Extract<InstallState, { phase: 'failed' }>; actions: Actions }) {
  return (
    <Card tone="needs" className="mt-2">
      <CardBody className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">{agent.label} did not install</span>
        <span className="text-xs text-(--fg2)">{state.reason}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="needs" onClick={() => { actions.ask([agent.program]) }}>Try again</Button>
          <Button size="sm" variant="ghost" onClick={() => { actions.cancel(agent.program) }}>Dismiss</Button>
        </div>
      </CardBody>
    </Card>
  )
}

function AgentRow({ agent, installed, version, state, actions }: { agent: Agent; installed: boolean | null; version: string | null | undefined; state: InstallState | undefined; actions: Actions }) {
  let status: ReactNode = null
  if (installed === null) status = <span className="text-xs text-(--dim)">looking…</span>
  else if (installed) status = <span className="inline-flex items-center gap-1.5"><StatusIcon status="done" />Installed</span>
  else if (!agent.installable) status = <span className="text-xs text-(--dim)">Not installable here</span>
  else if (state === undefined) status = <Button size="sm" variant="soft" aria-label={`Install ${agent.label}`} onClick={() => { actions.ask([agent.program]) }}>Install</Button>
  else if (state.phase === 'running') status = <span className="inline-flex items-center gap-1.5"><StatusIcon status="working" />{state.percent === null ? 'Installing' : `${String(Math.round(state.percent))}%`}</span>
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold">{agent.label}</span>
          <span className="text-xs text-(--dim)">{describe(agent, version)}</span>
        </span>
        <span className="flex-none">{status}</span>
      </div>
      {installed === false && state?.phase === 'asking' && <AskBody agent={agent} state={state} actions={actions} />}
      {installed === false && state?.phase === 'running' && <RunningBody agent={agent} state={state} />}
      {installed === false && state?.phase === 'failed' && <FailedBody agent={agent} state={state} actions={actions} />}
    </li>
  )
}

type Props = {
  headingRef: Ref<HTMLHeadingElement>
  /** Programs found on this computer; null while that is being read. */
  installed: readonly string[] | null
  states: Readonly<Record<string, InstallState>>
  /** Programs installed from here, with the version the installer reported. */
  done: Readonly<Record<string, string | null>>
  actions: Actions
}

/** Step 2: every supported agent, whether it is here, and a one-click install for the ones that are not. */
export function AgentsStep({ headingRef, installed, states, done, actions }: Props) {
  const isHere = (program: string): boolean | null => (program in done ? true : installed === null ? null : installed.includes(program))
  const missing = SETUP_AGENTS.filter((agent) => agent.installable && isHere(agent.program) === false)
  const idle = missing.filter((agent) => states[agent.program] === undefined).map((agent) => agent.program)
  const ready = missing.filter((agent) => { const state = states[agent.program]; return state?.phase === 'asking' && state.command !== null }).map((agent) => agent.program)
  return (
    <>
      <StepHead headingRef={headingRef} title="Your agents" lead="These are the agents Maiker supports. The ones you already have are ready to go; install the others with one click where Maiker can. Each one signs in with its own account the first time you start it." />
      <CardList aria-label="Agents">
        {SETUP_AGENTS.map((agent) => <AgentRow key={agent.program} agent={agent} installed={isHere(agent.program)} version={done[agent.program]} state={states[agent.program]} actions={actions} />)}
      </CardList>
      {ready.length > 1
        ? <Button variant="soft" className="self-start" onClick={() => { actions.run(ready) }}>Run all {ready.length}</Button>
        : idle.length > 1 && <Button variant="soft" className="self-start" onClick={() => { actions.ask(idle) }}>Install all {idle.length}</Button>}
    </>
  )
}

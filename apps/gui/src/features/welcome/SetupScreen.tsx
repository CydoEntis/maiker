import type { Ref } from 'react'
import { APP_NAME } from '@/brand'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { StatusIcon } from '@/components/ui/status-icon'
import { AppIcon, Icon } from '@/features/workspace/components/glyphs'
import { agentGroups, installableAgent, projectCount, projectTags, type AgentRow, type FolderOrigin } from './setup'
import type { Installs, InstallState } from './useAgentInstalls'
import type { ProjectsFolder } from './useProjectsFolder'

const ORIGIN_WORDS: Record<FolderOrigin | 'chosen', string> = {
  detected: 'Detected on this computer',
  saved: 'Saved earlier',
  home: 'Your user folder',
  chosen: 'Your choice',
}

/** The projects folder: where it is and why, the git projects found in it, and Change. */
function FolderCard({ folder, portalContainer }: { folder: ProjectsFolder; portalContainer: HTMLElement | null }) {
  const tags = folder.projects === null ? null : projectTags(folder.projects)
  return (
    <div className="mx-onb-card" role="group" aria-labelledby="mx-onb-folder">
      <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-3">
        <span aria-hidden="true" className="mx-onb-tile size-8"><Icon name="folder" size={16} /></span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="flex-none text-xs text-(--dim)">{folder.path === '' ? 'Looking for your projects…' : ORIGIN_WORDS[folder.origin]}</span>
          <span className="min-w-0 truncate font-(family-name:--mono) text-sm font-medium text-(--fg)">{folder.path}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="md" className="font-normal text-(--dim)" aria-label="Change the projects folder">Change</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" container={portalContainer} aria-label="Folders with code">
            {folder.others.map((other) => (
              <DropdownMenuItem key={other.path} className="gap-6" onSelect={() => { folder.choose(other.path) }}>
                <span className="font-(family-name:--mono)">{other.path}</span>
                <span className="ml-auto text-(--dim)">{projectCount(other.projects.length)}</span>
              </DropdownMenuItem>
            ))}
            {folder.others.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={folder.browse}>Choose another folder…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-h-[46px] flex-wrap items-center gap-[9px] border-t border-(--float-line) px-3.5 pt-2 pb-2.5 text-[12.5px] text-(--fg2)" role="status">
        {tags === null
          ? <span className="text-(--dim)">Looking for git projects…</span>
          : (
            <>
              <StatusIcon status="done" />
              <span>Found <b className="font-semibold text-(--fg)">{projectCount(folder.projects?.length ?? 0)}</b></span>
              {tags.shown.length > 0 && (
                <ul aria-label="Git projects found" className="m-0 flex list-none flex-wrap gap-[5px] p-0">
                  {tags.shown.map((name) => <li key={name} className="mx-onb-tag">{name}</li>)}
                  {tags.more > 0 && <li className="mx-onb-tag" aria-label={`and ${String(tags.more)} more`}>+{tags.more}</li>}
                </ul>
              )}
            </>
          )}
      </div>
      {folder.note !== '' && <p role="alert" className="m-0 border-t border-(--float-line) px-3.5 py-2 text-xs text-(--fg2)">{folder.note}</p>}
    </div>
  )
}

/** What a row says after the agent's name: where its install is, why it failed, or what the agent is. */
function detailOf(row: AgentRow, state: InstallState | undefined): string {
  if (state?.phase === 'asking') return state.command === null ? 'Looking up the command…' : 'Installing runs this command:'
  if (state?.phase === 'waiting') return 'Waiting for the other install.'
  if (state?.phase === 'running') return 'Installing in the background. You can carry on.'
  if (state?.phase === 'failed') return state.reason
  return row.agent.detail
}

/** An installed agent: its version where the button would be, when the installer reported one. */
function InstalledRow({ row }: { row: AgentRow }) {
  return (
    <li className="mx-onb-agent">
      <span aria-hidden="true" className="mx-onb-tile size-[26px]"><AppIcon process={row.agent.program} size={16} /></span>
      <span className="mx-onb-agent-text">
        <span className="flex-none text-[13.5px] font-semibold">{row.agent.label}</span>
        <span className="min-w-0 truncate text-xs text-(--dim)">{row.agent.detail}</span>
      </span>
      <span className="flex-none font-(family-name:--mono) text-[11.5px] text-(--dim)">{row.version === null ? 'Installed' : `v${row.version.replace(/^v/, '')}`}</span>
    </li>
  )
}

const ROW_BUTTON = 'min-w-[74px]'

/** What is at the right of an agent that is not here: Install, then Run and Cancel under the command, then how far it is. */
function MissingActions({ row, state, installs }: { row: AgentRow; state: InstallState | undefined; installs: Installs }) {
  const { program, label } = row.agent
  const installable = installableAgent(program)
  if (installable === null) return <span className="flex-none text-xs text-(--dim)">Not installable here</span>
  if (state === undefined) return <Button size="sm" variant="soft" className={ROW_BUTTON} aria-label={`Install ${label}`} onClick={() => { installs.ask(installable) }}>Install</Button>
  if (state.phase === 'failed') return <Button size="sm" variant="soft" className={ROW_BUTTON} aria-label={`Try installing ${label} again`} onClick={() => { installs.ask(installable) }}>Try again</Button>
  if (state.phase === 'waiting') return <span className="flex-none text-xs text-(--dim)">Queued</span>
  if (state.phase === 'running') return <span className="flex-none font-(family-name:--mono) text-xs text-(--fg2)">{state.percent === null ? 'Installing' : `${String(Math.round(state.percent))}%`}</span>
  return (
    <span className="flex flex-none gap-1.5">
      <Button size="sm" variant="ghost" aria-label={`Cancel installing ${label}`} onClick={() => { installs.dismiss(program) }}>Cancel</Button>
      <Button size="sm" variant="soft" disabled={state.command === null} aria-label={`Run the install of ${label}`} onClick={() => { installs.run(installable) }}>Run it</Button>
    </span>
  )
}

/** An agent that is not here: Install shows the command, Run it installs in place; one the app has no install for says so. */
function MissingRow({ row, state, installs }: { row: AgentRow; state: InstallState | undefined; installs: Installs }) {
  const command = state === undefined || state.phase === 'failed' ? null : state.command
  return (
    <li className="mx-onb-agent">
      <span aria-hidden="true" className="mx-onb-tile size-[26px]"><AppIcon process={row.agent.program} size={16} dimmed /></span>
      <span className="mx-onb-agent-text">
        <span className="flex-none text-[13.5px] font-semibold text-(--fg2)">{row.agent.label}</span>
        <span className="min-w-0 truncate text-xs text-(--dim)" {...(state?.phase === 'failed' ? { role: 'alert' } : {})}>{detailOf(row, state)}</span>
      </span>
      <MissingActions row={row} state={state} installs={installs} />
      {command !== null && <code className="mx-onb-agent-command">{command}</code>}
      {state?.phase === 'running' && <Progress className="mx-onb-agent-bar" label={`Installing ${row.agent.label}`} {...(state.percent === null ? {} : { value: state.percent })} />}
    </li>
  )
}

type Props = {
  headingId: string
  headingRef: Ref<HTMLHeadingElement>
  folder: ProjectsFolder
  /** Programs found on this computer; null while that is being read. */
  found: readonly string[] | null
  installs: Installs
  portalContainer: HTMLElement | null
}

/** Screen 1: the projects folder with what was found in it, and one list of agents, the installed ones first. */
export function SetupScreen({ headingId, headingRef, folder, found, installs, portalContainer }: Props) {
  const groups = agentGroups(found, installs.done)
  return (
    <>
      <h2 id={headingId} tabIndex={-1} ref={headingRef} className="mx-onb-title">Welcome to {APP_NAME}</h2>
      <p className="mx-onb-lead">Here’s what {APP_NAME} found on this computer. Install anything you’re missing.</p>
      <div className="mx-onb-label">
        <span id="mx-onb-folder" className="text-[13.5px] font-semibold text-(--fg)">Projects folder</span>
        <span className="text-[12.5px] text-(--dim)">New sessions start here and new repos are cloned into it.</span>
      </div>
      <FolderCard folder={folder} portalContainer={portalContainer} />
      <div className="mx-onb-label"><span id="mx-onb-agents" className="text-[13.5px] font-semibold text-(--fg)">Agents</span></div>
      <div className="mx-onb-card px-3.5" role="group" aria-labelledby="mx-onb-agents">
        {groups === null && <p role="status" className="m-0 py-3 text-[12.5px] text-(--dim)">Looking for agents…</p>}
        {groups !== null && groups.installed.length > 0 && (
          <>
            <div id="mx-onb-here" className="mx-onb-group">Installed</div>
            <ul aria-labelledby="mx-onb-here" className="m-0 list-none p-0">
              {groups.installed.map((row) => <InstalledRow key={row.agent.program} row={row} />)}
            </ul>
          </>
        )}
        {groups !== null && groups.missing.length > 0 && (
          <>
            <div id="mx-onb-missing" className="mx-onb-group">Not installed</div>
            <ul aria-labelledby="mx-onb-missing" className="m-0 list-none p-0">
              {groups.missing.map((row) => <MissingRow key={row.agent.program} row={row} state={installs.states[row.agent.program]} installs={installs} />)}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { AGENT_LABELS, confirmAdd, loadExtensions, removeExtension, setPluginEnabled, type AddPreview, type ExtensionFailure, type ExtensionResult, type ExtTarget, type Extension } from '@/api/extensions'
import { Switch } from '@/components/ui/switch'
import { Card, Row } from '@/features/settings/components/DesktopSettings'
import { errorMessage } from '@/lib/error-message'
import { AddCards, FailureLine } from './AddCards'
import { AddDialog } from './AddDialog'
import { ConfirmDialog } from './ConfirmDialog'
import type { ExtensionProject } from './projects'
import { AGENTS, detailLine, itemKey, itemsOf, KIND_ONE, KIND_ORDER, KIND_TITLE, NEXT_CHAT, SCOPE_WORDS, TERMINAL_ONLY } from './model'

const QUERY = ['extensions'] as const
/** The project picker's value for no project: only what is the user's. */
const NO_PROJECT = ''

function useExtensions(project: string | null) {
  return useQuery({
    queryKey: [...QUERY, project],
    queryFn: async () => {
      const told = await loadExtensions(project)
      if (!told.ok) throw new Error(told.failure.line)
      return told.value
    },
    retry: false,
  })
}

/** The change aimed at one listed item. A project's or local item is for the project the page is looking at. */
function targetOf(item: Extension, project: string | null): ExtTarget {
  return { agent: item.agent, kind: item.kind, id: item.id, scope: item.scope, project: item.scope === 'User' ? null : project }
}

type Dialog = { at: 'remove'; item: Extension } | { at: 'add'; preview: AddPreview }

function removeWords(item: Extension): string {
  if (item.kind === 'Skill') return `This deletes the skill's folder, ${item.id}, and everything in it from this computer. It cannot be undone.`
  if (item.kind === 'Marketplace') return 'Its plugins that are already installed stay. You can add the marketplace again later.'
  return `${AGENT_LABELS[item.agent]} takes it out ${SCOPE_WORDS[item.scope]}. You can add it again later.`
}

function ItemRow({ item, busy, onToggle, onRemove }: { item: Extension; busy: boolean; onToggle: (on: boolean) => void; onRemove: () => void }) {
  const switchable = item.kind === 'Plugin' && item.enabled !== null
  return (
    <Row label={item.name} detail={detailLine(item)}>
      {switchable && <Switch checked={item.enabled === true} disabled={busy} aria-label={`${item.enabled === true ? 'Turn off' : 'Turn on'} ${item.name}`} onCheckedChange={onToggle} />}
      <button type="button" className="mx-scard-button is-danger" disabled={busy} aria-label={`Remove ${item.name}`} onClick={onRemove}>Remove</button>
    </Row>
  )
}

/** The two things only an agent's own terminal does, folded to one row so the page stays short. */
function TerminalCard() {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <Card title="Needs a terminal">
      <Row label="Two things only a terminal does" detail="Signing in to an MCP server, and approving a project's shared servers.">
        <button type="button" className="mx-scard-button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setOpen(!open) }}>{open ? 'Hide' : 'Show'}</button>
      </Row>
      {open && (
        <div id={id}>
          {TERMINAL_ONLY.map((each) => (
            <Row key={each.title} label={each.title} detail={each.words}>{each.command !== null ? <code>{each.command}</code> : <span />}</Row>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * Settings › Extensions: the skills, plugins, MCP servers and marketplaces of Claude Code and Codex, for you and for a
 * project, so none of them needs a terminal. Listing reads files and starts nothing. Turning a plugin on or off and
 * removing ask the agent's own command; an add shows what it will run first and asks (`AddDialog`).
 */
export function ExtensionsSection({ projects }: { projects: readonly ExtensionProject[] }) {
  const client = useQueryClient()
  // Only this computer's projects: the daemon changes its own computer's agents.
  const here = projects.filter((project) => project.machineName === null)
  const [folder, setFolder] = useState<string | null>(null)
  const list = useExtensions(folder)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [failure, setFailure] = useState<ExtensionFailure | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // What a change said, then the list read again so the page shows what is really there.
  const settle = (told: ExtensionResult<string>) => {
    if (told.ok) {
      setFailure(null)
      setDone(told.value)
    } else {
      setDone(null)
      setFailure(told.failure)
    }
    void client.invalidateQueries({ queryKey: QUERY })
  }
  const toggle = (item: Extension, on: boolean) => {
    setBusyItem(itemKey(item))
    setFailure(null)
    setPluginEnabled(targetOf(item, folder), on)
      .then(settle, (error: unknown) => { setFailure({ line: errorMessage(error, 'The service did not answer'), terminal: null }) })
      .finally(() => { setBusyItem(null) })
  }
  /** Resolves with why the change was not made, or null when it was; the dialog stays open on a reason. */
  const finish = async (work: () => Promise<ExtensionResult<string>>): Promise<string | null> => {
    const told = await work()
    settle(told)
    if (told.ok) {
      setDialog(null)
      return null
    }
    return told.failure.terminal === null ? told.failure.line : `${told.failure.line} ${told.failure.terminal}`
  }

  const items = list.data?.items ?? []
  const projectLabel = here.find((project) => project.folder === folder)?.name
  return (
    <>
      <Card title="Where to look" foot={`${NEXT_CHAT} Skills, plugins and servers run code with your access, so only add ones you trust.`}>
        <Row label="Project" detail={folder === null ? 'Showing what is yours, for every project.' : `Showing yours and what ${projectLabel ?? 'this project'} adds.`}>
          <select className="mx-scard-input" aria-label="Project" value={folder ?? NO_PROJECT} onChange={(event) => { setFolder(event.target.value === NO_PROJECT ? null : event.target.value) }}>
            <option value={NO_PROJECT}>Just mine</option>
            {here.map((project) => <option key={project.linkKey} value={project.folder}>{project.name}</option>)}
          </select>
        </Row>
        {list.isError && <p role="alert" className="mx-scard-foot">Could not read what is installed: {errorMessage(list.error, 'the service did not answer')}</p>}
        {list.data !== undefined && list.data.problems.length > 0 && (
          <div role="status" className="mx-scard-foot">{list.data.problems.map((problem) => <p key={problem}>{problem}. It is left as it is.</p>)}</div>
        )}
        {done !== null && <p role="status" className="mx-scard-foot">{done}. {NEXT_CHAT}</p>}
        {failure !== null && <FailureLine failure={failure} />}
      </Card>

      {AGENTS.map((agent) => (
        <Card key={agent} title={AGENT_LABELS[agent]}>
          {list.isPending && <Row label="Reading…" detail="Looking at the files on this computer."><span /></Row>}
          {KIND_ORDER.map((kind) => {
            const these = itemsOf(items, agent, kind)
            return (
              <div key={kind} role="group" aria-label={`${AGENT_LABELS[agent]} ${KIND_TITLE[kind]}`}>
                {these.length === 0
                  ? !list.isPending && <Row label={KIND_TITLE[kind]} detail="None installed."><span /></Row>
                  : these.map((item) => (
                    <ItemRow key={itemKey(item)} item={item} busy={busyItem === itemKey(item)} onToggle={(on) => { toggle(item, on) }} onRemove={() => { setFailure(null); setDialog({ at: 'remove', item }) }} />
                  ))}
              </div>
            )
          })}
        </Card>
      ))}

      <AddCards folder={folder} onPreview={(preview) => { setFailure(null); setDialog({ at: 'add', preview }) }} />

      <TerminalCard />

      {dialog?.at === 'remove' && (
        <ConfirmDialog title={`Remove ${dialog.item.name}?`} confirmLabel={`Remove this ${KIND_ONE[dialog.item.kind]}`} danger onCancel={() => { setDialog(null) }} onConfirm={() => finish(() => removeExtension(targetOf(dialog.item, folder)))}>
          <p>{removeWords(dialog.item)}</p>
        </ConfirmDialog>
      )}
      {dialog?.at === 'add' && <AddDialog preview={dialog.preview} onCancel={() => { setDialog(null) }} onConfirm={(token) => finish(() => confirmAdd(token))} />}
    </>
  )
}

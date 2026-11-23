import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AGENT_LABELS, previewAdd, splitCommandLine, type AddPreview, type ExtAdd, type ExtAgent, type ExtensionFailure, type ExtKind, type ExtScope } from '@/api/extensions'
import { Card, Row } from '@/features/settings/components/DesktopSettings'
import { errorMessage } from '@/lib/error-message'
import { AGENTS, SCOPE_WORDS, scopesFor } from './model'

/** Longest name, source or command line the fields take; the daemon checks them again. */
const MOST_FIELD_CHARS = 500
/** Longest server name the daemon takes. */
const MOST_NAME_CHARS = 64

const REVIEW_DETAIL = 'See what it would run, read from its files. Nothing is installed until you confirm.'

/** What can be added from this page. A skill is only listed and removed. */
type AddKind = Exclude<ExtKind, 'Skill'>
const ADD_ORDER: readonly AddKind[] = ['Marketplace', 'Plugin', 'McpServer']
/** Each add's row while its form is closed, and the form's name. */
const ADD_ROW: Record<AddKind, { label: string; detail: string; title: string }> = {
  Marketplace: { label: 'Marketplace', detail: 'A list of plugins, from GitHub, an address or a folder.', title: 'Add a marketplace' },
  Plugin: { label: 'Plugin', detail: 'One plugin from a marketplace listed above.', title: 'Add a plugin' },
  McpServer: { label: 'MCP server', detail: 'A program the agent starts, or a server it connects to.', title: 'Add an MCP server' },
}

/** Why a request changed nothing, and the exact command when only a terminal can do it. */
export function FailureLine({ failure }: { failure: ExtensionFailure }) {
  return (
    <p role="alert" className="mx-scard-foot">
      {failure.line}
      {failure.terminal !== null && <> <code>{failure.terminal}</code></>}
    </p>
  )
}

/** Asks for a preview of an add, and keeps what went wrong. Nothing is installed by asking. */
function useReview(onPreview: (preview: AddPreview) => void) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ExtensionFailure | null>(null)
  const review = (add: ExtAdd) => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    previewAdd(add).then(
      (told) => { if (told.ok) onPreview(told.value); else setFailure(told.failure) },
      (error: unknown) => { setFailure({ line: errorMessage(error, 'The service did not answer'), terminal: null }) },
    ).finally(() => { setBusy(false) })
  }
  return { busy, failure, review }
}

function AgentSelect({ value, onChange }: { value: ExtAgent; onChange: (agent: ExtAgent) => void }) {
  return (
    <select className="mx-scard-input" aria-label="For which agent" value={value} onChange={(event) => { onChange(event.target.value === 'Codex' ? 'Codex' : 'Claude') }}>
      {AGENTS.map((agent) => <option key={agent} value={agent}>{AGENT_LABELS[agent]}</option>)}
    </select>
  )
}

function ScopeSelect({ agent, kind, value, onChange }: { agent: ExtAgent; kind: ExtKind; value: ExtScope; onChange: (scope: ExtScope) => void }) {
  const scopes = scopesFor(agent, kind)
  // Codex has only the user's scope, so a scope picked for Claude is dropped when the agent changes.
  const shown = scopes.includes(value) ? value : 'User'
  return (
    <select className="mx-scard-input" aria-label="Where it applies" value={shown} disabled={scopes.length === 1} onChange={(event) => { onChange(scopes.find((scope) => scope === event.target.value) ?? 'User') }}>
      {scopes.map((scope) => <option key={scope} value={scope}>{`Applies ${SCOPE_WORDS[scope]}`}</option>)}
    </select>
  )
}

/** The scope a form really uses, and whether it can be sent: a project scope needs a project picked at the top. */
function scopeOf(agent: ExtAgent, kind: ExtKind, picked: ExtScope, folder: string | null): { scope: ExtScope; project: string | null; needsProject: boolean } {
  const scope = scopesFor(agent, kind).includes(picked) ? picked : 'User'
  return { scope, project: scope === 'User' ? null : folder, needsProject: scope !== 'User' && folder === null }
}

const PICK_A_PROJECT = 'Pick a project at the top for this.'

type FormProps = { id: string; folder: string | null; onPreview: (preview: AddPreview) => void; onClose: () => void }

/**
 * What every add form shares: its fields, then Cancel and Review, then why a review was refused and its one note. Cancel
 * and Esc wait while a review is being read, so a preview never arrives for a form that is already closed.
 */
function AddForm({ id, kind, note, ready, busy, failure, onSubmit, onClose, children }: {
  id: string
  kind: AddKind
  note: string | null
  ready: boolean
  busy: boolean
  failure: ExtensionFailure | null
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}) {
  const shell = useRef<HTMLFormElement>(null)
  // The form opens to be typed into, so focus starts in its first field rather than staying on the row's button.
  useEffect(() => { shell.current?.querySelector<HTMLElement>('select, input')?.focus() }, [])
  return (
    // Settings leaves Esc to a part marked `data-owns-escape`, so Esc closes this form and Settings stays open.
    <form id={id} ref={shell} aria-label={ADD_ROW[kind].title} data-owns-escape="" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() } }} onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      {children}
      <Row label="Check first" detail={REVIEW_DETAIL}>
        <button type="button" className="mx-scard-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="mx-scard-button" disabled={!ready || busy}>{busy ? 'Reading…' : 'Review'}</button>
      </Row>
      {failure !== null && <FailureLine failure={failure} />}
      {note !== null && <p className="mx-scard-note">{note}</p>}
    </form>
  )
}

function PluginForm({ id, folder, onPreview, onClose }: FormProps) {
  const [agent, setAgent] = useState<ExtAgent>('Claude')
  const [plugin, setPlugin] = useState('')
  const [picked, setPicked] = useState<ExtScope>('User')
  const { busy, failure, review } = useReview(onPreview)
  const where = scopeOf(agent, 'Plugin', picked, folder)
  const ready = plugin.trim() !== '' && !where.needsProject
  return (
    <AddForm id={id} kind="Plugin" note={null} ready={ready} busy={busy} failure={failure} onClose={onClose} onSubmit={() => { if (ready) review({ Plugin: { agent, plugin: plugin.trim(), scope: where.scope, project: where.project } }) }}>
      <Row label="Agent" detail="Which agent gets it."><AgentSelect value={agent} onChange={setAgent} /></Row>
      <Row label="Plugin" detail="Named name@marketplace, for example hello@my-marketplace">
        <input className="mx-scard-input" aria-label="Plugin name@marketplace" value={plugin} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setPlugin(event.target.value) }} />
      </Row>
      <Row label="Where" detail={where.needsProject ? PICK_A_PROJECT : 'Who it applies to.'}><ScopeSelect agent={agent} kind="Plugin" value={picked} onChange={setPicked} /></Row>
    </AddForm>
  )
}

type McpHow = 'command' | 'address'

function McpForm({ id, folder, onPreview, onClose }: FormProps) {
  const [agent, setAgent] = useState<ExtAgent>('Claude')
  const [name, setName] = useState('')
  const [how, setHow] = useState<McpHow>('command')
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<ExtScope>('User')
  const [problem, setProblem] = useState<string | null>(null)
  const { busy, failure, review } = useReview(onPreview)
  const where = scopeOf(agent, 'McpServer', picked, folder)
  const ready = name.trim() !== '' && text.trim() !== '' && !where.needsProject
  const submit = () => {
    if (!ready) return
    if (how === 'address') {
      setProblem(null)
      review({ Mcp: { agent, name: name.trim(), run: { Url: { url: text.trim() } }, scope: where.scope, project: where.project } })
      return
    }
    const line = splitCommandLine(text)
    if (line === null) {
      setProblem('That command line has an open quote.')
      return
    }
    setProblem(null)
    review({ Mcp: { agent, name: name.trim(), run: { Command: line }, scope: where.scope, project: where.project } })
  }
  return (
    <AddForm id={id} kind="McpServer" note="A server that needs a key or a header cannot be added here yet: add it in the agent's own terminal." ready={ready} busy={busy} failure={failure} onClose={onClose} onSubmit={submit}>
      <Row label="Agent" detail="Which agent gets it."><AgentSelect value={agent} onChange={setAgent} /></Row>
      <Row label="Name" detail="Letters, digits, dots, dashes and underscores.">
        <input className="mx-scard-input" aria-label="Server name" value={name} maxLength={MOST_NAME_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setName(event.target.value) }} />
      </Row>
      <Row label="How it runs" detail={how === 'command' ? 'A program the agent starts, as you.' : 'A server somewhere else. https:// only (http:// for this computer), with no sign-in in the address.'}>
        <select className="mx-scard-input" aria-label="How the server runs" value={how} onChange={(event) => { setHow(event.target.value === 'address' ? 'address' : 'command') }}>
          <option value="command">A command</option>
          <option value="address">An address</option>
        </select>
      </Row>
      <Row label={how === 'command' ? 'Command' : 'Address'} detail={problem ?? (how === 'command' ? 'For example npx -y @scope/server' : 'For example https://mcp.example.com/sse')}>
        <input className={`mx-scard-input${problem === null ? '' : ' is-invalid'}`} aria-label={how === 'command' ? 'Server command' : 'Server address'} value={text} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setText(event.target.value); setProblem(null) }} />
      </Row>
      <Row label="Where" detail={where.needsProject ? PICK_A_PROJECT : 'Who it applies to.'}><ScopeSelect agent={agent} kind="McpServer" value={picked} onChange={setPicked} /></Row>
    </AddForm>
  )
}

function MarketplaceForm({ id, onPreview, onClose }: FormProps) {
  const [agent, setAgent] = useState<ExtAgent>('Claude')
  const [source, setSource] = useState('')
  const { busy, failure, review } = useReview(onPreview)
  const ready = source.trim() !== ''
  return (
    <AddForm id={id} kind="Marketplace" note="Adding a marketplace installs nothing, but every plugin in it is then one click from running code." ready={ready} busy={busy} failure={failure} onClose={onClose} onSubmit={() => { if (ready) review({ Marketplace: { agent, source: source.trim() } }) }}>
      <Row label="Agent" detail="Which agent gets it."><AgentSelect value={agent} onChange={setAgent} /></Row>
      <Row label="Source" detail="A GitHub owner/repo, an https:// address or a full folder path.">
        <input className="mx-scard-input" aria-label="Marketplace source" value={source} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setSource(event.target.value) }} />
      </Row>
    </AddForm>
  )
}

const FORMS: Record<AddKind, (props: FormProps) => ReactNode> = { Marketplace: MarketplaceForm, Plugin: PluginForm, McpServer: McpForm }

/**
 * The three things that can be added, one row each, so the page stays short. A row's button opens its form under it and
 * closes any other; Cancel or Esc closes it and gives focus back to that button. A form only asks for a preview; the page
 * shows it and asks before anything runs.
 */
export function AddCards({ folder, onPreview }: { folder: string | null; onPreview: (preview: AddPreview) => void }) {
  const [open, setOpen] = useState<AddKind | null>(null)
  const triggers = useRef(new Map<AddKind, HTMLButtonElement>())
  const formId = useId()
  const close = (kind: AddKind) => {
    setOpen(null)
    triggers.current.get(kind)?.focus()
  }
  return (
    <Card title="Add">
      {ADD_ORDER.map((kind) => {
        const shown = open === kind
        const Form = FORMS[kind]
        const id = `${formId}-${kind}`
        return (
          <Fragment key={kind}>
            <Row label={ADD_ROW[kind].label} detail={ADD_ROW[kind].detail}>
              <button
                type="button"
                ref={(node) => { if (node === null) triggers.current.delete(kind); else triggers.current.set(kind, node) }}
                className="mx-scard-button"
                aria-label={ADD_ROW[kind].title}
                aria-expanded={shown}
                aria-controls={shown ? id : undefined}
                onClick={() => { setOpen(shown ? null : kind) }}
              >Add…</button>
            </Row>
            {shown && <Form id={id} folder={folder} onPreview={onPreview} onClose={() => { close(kind) }} />}
          </Fragment>
        )
      })}
    </Card>
  )
}

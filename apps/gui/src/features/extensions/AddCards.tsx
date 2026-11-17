import { useState } from 'react'
import { AGENT_LABELS, previewAdd, splitCommandLine, type AddPreview, type ExtAdd, type ExtAgent, type ExtensionFailure, type ExtKind, type ExtScope } from '@/api/extensions'
import { Card, Row } from '@/features/settings/components/DesktopSettings'
import { errorMessage } from '@/lib/error-message'
import { AGENTS, SCOPE_WORDS, scopesFor } from './model'

/** Longest name, source or command line the fields take; the daemon checks them again. */
const MOST_FIELD_CHARS = 500
/** Longest server name the daemon takes. */
const MOST_NAME_CHARS = 64

const REVIEW_FOOT = 'Review shows what it would run, read from its files. Nothing is installed until you confirm.'

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

function PluginCard({ folder, onPreview }: { folder: string | null; onPreview: (preview: AddPreview) => void }) {
  const [agent, setAgent] = useState<ExtAgent>('Claude')
  const [plugin, setPlugin] = useState('')
  const [picked, setPicked] = useState<ExtScope>('User')
  const { busy, failure, review } = useReview(onPreview)
  const where = scopeOf(agent, 'Plugin', picked, folder)
  const ready = plugin.trim() !== '' && !where.needsProject
  return (
    <Card title="Add a plugin" foot={`Name it as name@marketplace, from a marketplace listed above. ${REVIEW_FOOT}`}>
      <form onSubmit={(event) => { event.preventDefault(); if (ready) review({ Plugin: { agent, plugin: plugin.trim(), scope: where.scope, project: where.project } }) }}>
        <Row label="Agent" detail="Which agent gets it."><AgentSelect value={agent} onChange={setAgent} /></Row>
        <Row label="Plugin" detail="For example hello@my-marketplace">
          <input className="mx-scard-input" aria-label="Plugin name@marketplace" value={plugin} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setPlugin(event.target.value) }} />
        </Row>
        <Row label="Where" detail={where.needsProject ? PICK_A_PROJECT : 'Who it applies to.'}><ScopeSelect agent={agent} kind="Plugin" value={picked} onChange={setPicked} /></Row>
        <Row label="Check first" detail="See what it would run. Nothing is installed yet."><button type="submit" className="mx-scard-button" disabled={!ready || busy}>{busy ? 'Reading…' : 'Review'}</button></Row>
      </form>
      {failure !== null && <FailureLine failure={failure} />}
    </Card>
  )
}

type McpHow = 'command' | 'address'

function McpCard({ folder, onPreview }: { folder: string | null; onPreview: (preview: AddPreview) => void }) {
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
    <Card title="Add an MCP server" foot={`A server that needs a key or a header cannot be added here yet: add it in the agent's own terminal. ${REVIEW_FOOT}`}>
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
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
        <Row label="Check first" detail="See what it would run. Nothing is installed yet."><button type="submit" className="mx-scard-button" disabled={!ready || busy}>{busy ? 'Reading…' : 'Review'}</button></Row>
      </form>
      {failure !== null && <FailureLine failure={failure} />}
    </Card>
  )
}

function MarketplaceCard({ onPreview }: { onPreview: (preview: AddPreview) => void }) {
  const [agent, setAgent] = useState<ExtAgent>('Claude')
  const [source, setSource] = useState('')
  const { busy, failure, review } = useReview(onPreview)
  const ready = source.trim() !== ''
  return (
    <Card title="Add a marketplace" foot={`A marketplace is a list of plugins. Adding one installs nothing, but every plugin in it is then one click from running code. ${REVIEW_FOOT}`}>
      <form onSubmit={(event) => { event.preventDefault(); if (ready) review({ Marketplace: { agent, source: source.trim() } }) }}>
        <Row label="Agent" detail="Which agent gets it."><AgentSelect value={agent} onChange={setAgent} /></Row>
        <Row label="Source" detail="A GitHub owner/repo, an https:// address or a full folder path.">
          <input className="mx-scard-input" aria-label="Marketplace source" value={source} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setSource(event.target.value) }} />
        </Row>
        <Row label="Check first" detail="See what it would run. Nothing is installed yet."><button type="submit" className="mx-scard-button" disabled={!ready || busy}>{busy ? 'Reading…' : 'Review'}</button></Row>
      </form>
      {failure !== null && <FailureLine failure={failure} />}
    </Card>
  )
}

/** The three things that can be added. Each one only asks for a preview; the page shows it and asks before anything runs. */
export function AddCards({ folder, onPreview }: { folder: string | null; onPreview: (preview: AddPreview) => void }) {
  return (
    <>
      <MarketplaceCard onPreview={onPreview} />
      <PluginCard folder={folder} onPreview={onPreview} />
      <McpCard folder={folder} onPreview={onPreview} />
    </>
  )
}

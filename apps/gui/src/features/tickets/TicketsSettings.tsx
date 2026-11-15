import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadGitHubAccounts } from '@/api/githubAccounts'
import { LOCAL_MACHINE } from '@/api/machines'
import { githubRepoOf, loadTicketKeys, removeTicketKey, saveTicketKey, type KeyedProvider, type TicketGroup, type TicketKeyState, type TicketsResult } from '@/api/tickets'
import { Card, Row } from '@/features/settings/components/DesktopSettings'
import { PickerSelect, type PickerItem } from '@/features/settings/components/PickerSelect'
import type { GitHubSignIn } from '@/features/settings/components/GitHubSection'
import { errorMessage } from '@/lib/error-message'
import { linkOf, setMyName, setProjectLink, useTicketLinks, type ProjectLink } from './model/ticketLinks'
import type { TicketsProject } from './model/ticketProjects'
import { PROVIDER_LOOK, type Provider } from './model/tickets'
import { failureOf, useTicketGroups } from './useTicketData'
import './tickets.css'

/** Plane Cloud's address, the one most people use. A self-hosted Plane has its own. */
const PLANE_CLOUD = 'https://app.plane.so'
/** Longest key or address the fields take; the daemon checks them again. */
const MOST_FIELD_CHARS = 512
const MOST_NAME_CHARS = 100
const NOTHING = 'none'
/** `owner/name`, as GitHub spells a repository. */
const REPO_SHAPE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
/** Where a key goes once saved (the service's choice, not the system keychain). */
const KEPT_WHERE = 'The key is kept by the Maitty service in its data folder on this computer, not in the system keychain, and never shown again.'
const KEYS_QUERY = ['tickets', 'keys'] as const

type Keyed = { provider: KeyedProvider; source: 'plane' | 'linear' }
const KEYED: readonly Keyed[] = [{ provider: 'Plane', source: 'plane' }, { provider: 'Linear', source: 'linear' }]

function keyStateOf(keys: readonly TicketKeyState[] | undefined, provider: KeyedProvider): TicketKeyState | null {
  return keys?.find((key) => key.provider === provider) ?? null
}

function useKeys() {
  return useQuery({ queryKey: KEYS_QUERY, queryFn: async () => { const told = await loadTicketKeys(); return told.ok ? told.value : [] }, retry: false })
}

function Mark({ provider }: { provider: Provider }) {
  const look = PROVIDER_LOOK[provider]
  return <span className="mx-tk-mark is-small" style={{ color: look.color }}>{look.mark}</span>
}

/** GitHub: the gh login on this computer. Maitty keeps no GitHub key. */
function GitHubCard({ signIn }: { signIn: GitHubSignIn | undefined }) {
  const login = useQuery({ queryKey: ['tickets', 'github-login'], queryFn: () => loadGitHubAccounts(LOCAL_MACHINE), retry: false, staleTime: Infinity })
  const { refetch } = login
  const ended = signIn?.signInsEnded ?? 0
  useEffect(() => { if (ended > 0) void refetch() }, [ended, refetch])
  const report = login.data
  const account = report?.accounts.find((each) => each.active) ?? report?.accounts[0]
  const signedOut = report !== undefined && report.installed && report.problem === null && account === undefined
  const words = login.isPending ? 'Checking…'
    : login.isError ? `Could not check: ${errorMessage(login.error, 'the service did not answer')}`
      : !report?.installed ? 'The GitHub command line (gh) is not installed. Get it from cli.github.com'
        : report.problem !== null ? `Could not check: ${report.problem}`
          : account === undefined ? 'Not signed in. Run gh auth login in a terminal, then check again.'
            : `Signed in with gh as @${account.login}`
  return (
    <Card title="GitHub" meta={<button type="button" className="mx-text-button" onClick={() => { void refetch() }}>Check again</button>}
      foot="Tickets uses the GitHub command line's own login, so there is no key to paste and Maitty keeps none.">
      <Row label="GitHub" detail={words}>
        <Mark provider="github" />
        {signedOut && signIn !== undefined && <button type="button" className="mx-scard-button" onClick={() => { signIn.onSignIn(LOCAL_MACHINE, 'This computer') }}>Open terminal</button>}
      </Row>
    </Card>
  )
}

/** Plane or Linear: its key (and Plane's address and workspace), given to the service once and never shown again. */
function KeyCard({ provider, source }: Keyed) {
  const client = useQueryClient()
  const keys = useKeys()
  const state = keyStateOf(keys.data, provider)
  const set = state?.set ?? false
  const groups = useTicketGroups(set ? source : null)
  const refused = set && failureOf(groups.error)?.kind === 'signed-out'
  const [replacing, setReplacing] = useState(false)
  // Null until typed in: the field shows what the service has, or Plane Cloud.
  const [address, setAddress] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const plane = provider === 'Plane'
  const formOpen = !set || replacing || refused
  const savedAddress = state?.address ?? ''
  const shownAddress = address ?? (savedAddress === '' ? PLANE_CLOUD : savedAddress)
  const shownWorkspace = workspace ?? state?.workspace ?? ''
  const addressOk = !plane || /^https?:\/\/\S+$/.test(shownAddress.trim())
  const ready = key.trim() !== '' && addressOk && (!plane || shownWorkspace.trim() !== '')

  const settle = (told: TicketsResult<TicketKeyState[]>, failed: string) => {
    if (!told.ok) {
      setNote(told.failure.kind === 'unreachable' || told.failure.kind === 'invalid' ? `${failed}: ${told.failure.line}` : failed)
      return
    }
    client.setQueryData(KEYS_QUERY, told.value)
    void client.invalidateQueries({ queryKey: ['tickets'], predicate: (query) => query.queryKey.includes(source) })
    setKey('')
    setReplacing(false)
    setNote(null)
  }
  const run = (work: () => Promise<TicketsResult<TicketKeyState[]>>, failed: string) => {
    setBusy(true)
    work().then((told) => { settle(told, failed) }, (error: unknown) => { setNote(errorMessage(error, failed)) }).finally(() => { setBusy(false) })
  }
  const save = () => { if (ready && !busy) run(() => saveTicketKey(provider, plane ? shownAddress : '', plane ? shownWorkspace : '', key), `Could not save the ${provider} key`) }

  const status = !set ? 'Not connected'
    : refused ? `✕ Key refused. ${provider} refused the saved key: paste a new one.`
      : `Connected · key saved${plane && state !== null ? ` · ${state.address}/${state.workspace}` : ''}`
  const where = plane ? 'Your Plane address (Plane Cloud is app.plane.so), its workspace slug, and an API key from Profile › API tokens.' : 'An API key from Linear › Settings › Security & access.'
  return (
    <Card title={provider} foot={`${where} ${KEPT_WHERE}`}>
      <Row label={provider} detail={status}>
        <Mark provider={source} />
        {set && !formOpen && <button type="button" className="mx-scard-button" disabled={busy} onClick={() => { setReplacing(true) }}>Replace key</button>}
        {set && <button type="button" className="mx-scard-button is-danger" disabled={busy} onClick={() => { run(() => removeTicketKey(provider), `Could not remove the ${provider} key`) }}>Remove</button>}
      </Row>
      {formOpen && (
        <form onSubmit={(event) => { event.preventDefault(); save() }}>
          {plane && (
            <>
              <Row label="Address" detail={addressOk ? 'Where your Plane is.' : 'Starts with https://'}>
                <input className={`mx-scard-input${addressOk ? '' : ' is-invalid'}`} aria-label="Plane address" value={shownAddress} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setAddress(event.target.value) }} />
              </Row>
              <Row label="Workspace" detail="The slug in your Plane addresses.">
                <input className="mx-scard-input" aria-label="Plane workspace" value={shownWorkspace} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setWorkspace(event.target.value) }} />
              </Row>
            </>
          )}
          <Row label="API key" detail={set ? 'The saved key is never shown. Paste a new one to replace it.' : 'Pasted once, then never shown again.'}>
            <input className={`mx-scard-input${refused ? ' is-invalid' : ''}`} type="password" autoComplete="off" spellCheck={false} aria-label={`${provider} API key`} value={key} maxLength={MOST_FIELD_CHARS} onChange={(event) => { setKey(event.target.value) }} />
            <button type="submit" className="mx-scard-button is-primary" disabled={!ready || busy}>{set ? 'Replace' : 'Connect'}</button>
            {replacing && <button type="button" className="mx-scard-button" onClick={() => { setReplacing(false); setKey('') }}>Cancel</button>}
          </Row>
        </form>
      )}
      {note !== null && <p className="mx-scard-note" role="alert">{note}</p>}
    </Card>
  )
}

/** The choices of a picker for the top groups of a source: none, then each. */
function groupItems(provider: Provider, groups: readonly TicketGroup[] | undefined): PickerItem[] {
  const tile = <Mark provider={provider} />
  const top = (groups ?? []).filter((group) => group.parent === null).map((group) => ({ value: group.id, label: group.name, tile }))
  return [{ value: NOTHING, label: 'Not linked', tile }, ...top]
}

function GroupPick({ project, source, link, keyed }: { project: TicketsProject; source: 'plane' | 'linear'; link: ProjectLink; keyed: boolean }) {
  const groups = useTicketGroups(keyed ? source : null)
  const picked = link[source]
  const what = source === 'plane' ? 'Plane project' : 'Linear team'
  const items = groupItems(source, groups.data)
  if (picked !== null && !items.some((item) => item.value === picked.id)) items.push({ value: picked.id, label: picked.name, tile: <Mark provider={source} /> })
  const detail = !keyed ? `Connect ${PROVIDER_LOOK[source].name} above first.` : groups.isPending ? 'Reading…' : groups.isError ? 'Could not read them.' : undefined
  return (
    <Row label={`${project.name} · ${what}`} {...(detail === undefined ? {} : { detail })}>
      {keyed && (
        <PickerSelect label={`${what} for ${project.name}`} value={picked?.id ?? NOTHING} groups={[{ items }]} width={220}
          onPick={(value) => { setProjectLink(project.linkKey, { [source]: value === NOTHING ? null : { id: value, name: items.find((item) => item.value === value)?.label ?? value } }) }} />
      )}
    </Row>
  )
}

/** A field kept on leaving it (or Enter), so a half-typed value never takes effect. Keyed by its value, it starts again when that changes. */
function KeptField({ label, value, placeholder, valid, maxLength, onKeep }: { label: string; value: string; placeholder: string; valid: (text: string) => boolean; maxLength: number; onKeep: (text: string) => void }) {
  const [text, setText] = useState(value)
  const ok = valid(text.trim())
  const keep = () => { if (ok && text.trim() !== value) onKeep(text.trim()) }
  return (
    <input className={`mx-scard-input${ok ? '' : ' is-invalid'}`} aria-label={label} value={text} placeholder={placeholder} maxLength={maxLength} spellCheck={false} autoComplete="off"
      onChange={(event) => { setText(event.target.value) }} onBlur={keep} onKeyDown={(event) => { if (event.key === 'Enter') keep() }} />
  )
}

function ProjectRows({ project, keyed }: { project: TicketsProject; keyed: Readonly<Record<'plane' | 'linear', boolean>> }) {
  const links = useTicketLinks()
  const link = linkOf(links, project.linkKey)
  const local = project.machine === LOCAL_MACHINE
  const origin = useQuery({ queryKey: ['tickets', 'origin', project.machine, project.folder], queryFn: () => githubRepoOf(project.folder), enabled: local, retry: false, staleTime: Infinity })
  const detected = origin.data ?? null
  const repoDetail = link.github !== null && link.github !== '' ? 'Set here. Empty it to follow the folder\'s origin.'
    : detected !== null ? `From the folder's origin: ${detected}` : local ? 'No GitHub origin found. Type owner/name.' : 'Type owner/name.'
  return (
    <>
      <Row label={`${project.name} · GitHub repo`} detail={repoDetail}>
        <KeptField key={link.github ?? ''} label={`GitHub repo for ${project.name}`} value={link.github ?? ''} placeholder={detected ?? 'owner/name'} maxLength={140}
          valid={(text) => text === '' || REPO_SHAPE.test(text)} onKeep={(text) => { setProjectLink(project.linkKey, { github: text === '' ? null : text }) }} />
      </Row>
      <GroupPick project={project} source="plane" link={link} keyed={keyed.plane} />
      <GroupPick project={project} source="linear" link={link} keyed={keyed.linear} />
    </>
  )
}

/**
 * Settings › Tickets: where Tickets reads from, one card per source, then which repo, Plane project and Linear team
 * each open project reads, and the names you go by for Mine. Keys go to the Maitty service and are never shown again.
 */
export function TicketsSection({ projects, signIn }: { projects: readonly TicketsProject[]; signIn: GitHubSignIn | undefined }) {
  const keys = useKeys()
  const links = useTicketLinks()
  const keyed = { plane: keyStateOf(keys.data, 'Plane')?.set ?? false, linear: keyStateOf(keys.data, 'Linear')?.set ?? false }
  return (
    <>
      <GitHubCard signIn={signIn} />
      {KEYED.map((each) => <KeyCard key={each.provider} {...each} />)}
      <Card title="Projects" foot="Tickets shows only the tickets of the project the chat in front works in. Links are kept by this window.">
        {projects.length === 0
          ? <p className="mx-scard-note">Open a chat in a project to link it here.</p>
          : projects.map((project) => <ProjectRows key={project.linkKey} project={project} keyed={keyed} />)}
      </Card>
      <Card title="You" foot="Mine shows the tickets assigned to you. GitHub knows you by your gh login.">
        {KEYED.map(({ provider, source }) => (
          <Row key={provider} label={`Your name in ${provider}`} detail="As it shows on tickets assigned to you.">
            <KeptField key={links.me[source]} label={`Your name in ${provider}`} value={links.me[source]} placeholder="Display name" maxLength={MOST_NAME_CHARS} valid={() => true} onKeep={(text) => { setMyName(source, text) }} />
          </Row>
        ))}
      </Card>
    </>
  )
}

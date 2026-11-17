import { useContext, useEffect, useState } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadGitHubAccounts } from '@/api/githubAccounts'
import { LOCAL_MACHINE } from '@/api/machines'
import { githubRepoOf, loadTicketKeys, removeTicketKey, saveTicketKey, type KeyedProvider, type KeyStorage, type TicketGroup, type TicketKeyState, type TicketsResult } from '@/api/tickets'
import { Card, Row } from '@/features/settings/components/DesktopSettings'
import { SettingsSearch } from '@/features/settings/settingsSearch'
import { PickerSelect, type PickerItem } from '@/features/settings/components/PickerSelect'
import type { GitHubSignIn } from '@/features/settings/components/GitHubSection'
import { errorMessage } from '@/lib/error-message'
import { REPO_TICKETS_FILE, type LinkedProject, type RepoTicketFile, type TicketPlace } from '@/api/ticketLinks'
import { NO_LINK, useLinkChanges, useTicketLinks, type ProjectLink } from './model/ticketLinks'
import { KEY_ONCE, PLANE_CLOUD, REPO_SHAPE } from './TicketSetup'
import { parseTicketLink, PASTED_LINK_MAX_CHARS } from './model/pastedLink'
import type { TicketsProject } from './model/ticketProjects'
import { PROVIDER_LOOK, type Provider } from './model/tickets'
import { failureOf, useTicketGroups } from './useTicketData'
import './tickets.css'

/** Longest key or address the fields take; the daemon checks them again. */
const MOST_FIELD_CHARS = 512
const MOST_NAME_CHARS = 100
const NOTHING = 'none'
const KEYS_QUERY = ['tickets', 'keys'] as const

type Keyed = { provider: KeyedProvider; source: 'plane' | 'linear' }
const KEYED: readonly Keyed[] = [{ provider: 'Plane', source: 'plane' }, { provider: 'Linear', source: 'linear' }]

/** Where the service keeps a key, said beside it. The key itself is never shown. */
const KEPT_IN: Record<KeyStorage, string> = { Keychain: 'Key kept in your system keychain', File: 'Key kept in a file: no keychain on this machine' }

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

/** GitHub: the gh login on this computer. Maiker keeps no GitHub key. */
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
      foot="Tickets uses the GitHub command line's own login, so there is no key to paste and Maiker keeps none.">
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
  const [pasteText, setPasteText] = useState('')
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const plane = provider === 'Plane'
  const fillFromLink = () => {
    const read = parseTicketLink(pasteText)
    if (!read.ok || read.link.kind !== 'plane') {
      setPasteNote(read.ok ? 'That is not a link to a Plane' : read.reason)
      return
    }
    setPasteNote(null)
    setAddress(read.link.address)
    setWorkspace(read.link.workspace)
  }
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
      : `Connected${plane && state !== null ? ` · ${state.address}/${state.workspace}` : ''} · ${KEPT_IN[state?.stored_in ?? 'File']}`
  const where = plane ? 'Your Plane address (Plane Cloud is app.plane.so), its workspace slug, and an API key from Profile › API tokens.' : 'An API key from Linear › Settings › Security & access.'
  return (
    <Card title={provider} foot={`${where} ${KEY_ONCE}`}>
      <Row label={provider} detail={status}>
        <Mark provider={source} />
        {set && !formOpen && <button type="button" className="mx-scard-button" disabled={busy} onClick={() => { setReplacing(true) }}>Replace key</button>}
        {set && <button type="button" className="mx-scard-button is-danger" disabled={busy} onClick={() => { run(() => removeTicketKey(provider), `Could not remove the ${provider} key`) }}>Remove</button>}
      </Row>
      {formOpen && (
        <form onSubmit={(event) => { event.preventDefault(); save() }}>
          {plane && (
            <>
              <Row label="Link" detail={pasteNote ?? 'Paste any page of your Plane to fill the address and workspace.'}>
                <input className={`mx-scard-input${pasteNote === null ? '' : ' is-invalid'}`} aria-label="Link to your Plane" placeholder="https://app.plane.so/workspace/projects/…" value={pasteText} maxLength={PASTED_LINK_MAX_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setPasteText(event.target.value); setPasteNote(null) }} />
                <button type="button" className="mx-scard-button" disabled={pasteText.trim() === ''} onClick={fillFromLink}>Use link</button>
              </Row>
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

/** A project as Settings lists it: its name, where the daemon keeps it, and whether its folder is on this computer. */
type ListedProject = { name: string; place: TicketPlace; local: boolean; link: ProjectLink }

/** A part of the page: its heading and what it is for. Search results show only groups, so it is left out there. */
function Part({ title, sub }: { title: string; sub: string }) {
  if (useContext(SettingsSearch) !== null) return null
  return (
    <>
      <h3 className="mx-tk-settings-part">{title}</h3>
      <p className="mx-tk-settings-sub">{sub}</p>
    </>
  )
}

/** Settles a change: a refusal is said in place, never dropped. */
function useSaved() {
  const [note, setNote] = useState<string | null>(null)
  const settle = (work: Promise<TicketsResult<unknown>>, failed: string) => {
    work.then((told) => { setNote(told.ok ? null : told.failure.kind === 'invalid' || told.failure.kind === 'unreachable' ? `${failed}: ${told.failure.line}` : failed) }, (error: unknown) => { setNote(errorMessage(error, failed)) })
  }
  return { note, settle }
}

function GroupPick({ project, source, keyed, onSave }: { project: ListedProject; source: 'plane' | 'linear'; keyed: boolean; onSave: (link: ProjectLink) => void }) {
  const groups = useTicketGroups(keyed ? source : null)
  const picked = project.link[source]
  const what = source === 'plane' ? 'Plane project' : 'Linear team'
  const items = groupItems(source, groups.data)
  if (picked !== null && !items.some((item) => item.value === picked.id)) items.push({ value: picked.id, label: picked.name, tile: <Mark provider={source} /> })
  const detail = !keyed ? `Connect ${PROVIDER_LOOK[source].name} under Accounts first.` : groups.isPending ? 'Reading…' : groups.isError ? 'Could not read them.' : undefined
  return (
    <Row label={what} {...(detail === undefined ? {} : { detail })}>
      {keyed && (
        <PickerSelect label={`${what} for ${project.name}`} value={picked?.id ?? NOTHING} groups={[{ items }]} width={220}
          onPick={(value) => { onSave({ ...project.link, [source]: value === NOTHING ? null : { id: value, name: items.find((item) => item.value === value)?.label ?? value } }) }} />
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

/** What a project reads, in one line: "GitHub me/shop · Linear Core". */
function readsLine(link: ProjectLink): string {
  const github = link.github === null ? 'GitHub from origin' : link.github === '' ? 'GitHub off' : `GitHub ${link.github}`
  return [github, link.plane === null ? null : `Plane ${link.plane.name}`, link.linear === null ? null : `Linear ${link.linear.name}`].filter((part) => part !== null).join(' · ')
}

/** Which sources a repository file gave, in words: "GitHub and Plane from .maitty/tickets.toml"; null when none. */
function fromFileLine(file: RepoTicketFile | null | undefined): string | null {
  if (file == null) return null
  const parts = [file.github ? 'GitHub' : null, file.plane ? 'Plane' : null, file.linear ? 'Linear' : null].filter((part) => part !== null)
  if (parts.length === 0) return null
  const named = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${String(parts.at(-1))}`
  return `${String(named)} from the repo's ${REPO_TICKETS_FILE}`
}

/** The last part of a folder, as a project's name when no open session names it. */
function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter((part) => part !== '').pop() ?? folder
}

/** One project: what it reads in a line, Change to set its sources here, Unlink to forget them. */
function ProjectEntry({ project, keyed, linked }: { project: ListedProject; keyed: Readonly<Record<'plane' | 'linear', boolean>>; linked: boolean }) {
  const { save, unlink } = useLinkChanges()
  const { note, settle } = useSaved()
  const [open, setOpen] = useState(false)
  // What it reads, with its repository's own file filling what was not linked here; the file's words are the daemon's,
  // cleaned, and shown as text.
  const asked = useTicketLinks(project.local ? { machineName: project.place.machine, folder: project.place.folder } : null)
  const file = project.local ? asked.data?.repoFile ?? null : null
  const fromFile = fromFileLine(file)
  const reads = fromFile === null ? project.link : asked.data?.project?.link ?? project.link
  const origin = useQuery({ queryKey: ['tickets', 'origin', project.place.machine, project.place.folder], queryFn: () => githubRepoOf(project.place.folder), enabled: open && project.local, retry: false, staleTime: Infinity })
  const detected = origin.data ?? null
  const keep = (link: ProjectLink) => { settle(save(project.place, link), 'Could not save the link') }
  const repoDetail = project.link.github !== null && project.link.github !== '' ? 'Set here. Empty it to follow the folder\'s origin.'
    : detected !== null ? `From the folder's origin: ${detected}` : project.local ? 'No GitHub origin found. Type owner/name.' : 'Type owner/name.'
  const where = `${project.place.machine === null ? '' : `${project.place.machine} · `}${project.place.folder}`
  return (
    <>
      <Row label={project.name} detail={`${where} · ${linked || fromFile !== null ? readsLine(reads) : 'Not set up yet'}${fromFile === null ? '' : ` · ${fromFile}`}`}>
        <button type="button" className="mx-scard-button" aria-expanded={open} onClick={() => { setOpen((now) => !now) }}>{open ? 'Done' : linked ? 'Change' : 'Set up'}</button>
        {linked && <button type="button" className="mx-scard-button is-danger" onClick={() => { settle(unlink(project.place), 'Could not unlink it') }}>Unlink</button>}
      </Row>
      {file?.notes.map((line) => <p key={line} className="mx-scard-note">{line}</p>)}
      {open && (
        <>
          <Row label="GitHub repo" detail={repoDetail}>
            <KeptField key={project.link.github ?? ''} label={`GitHub repo for ${project.name}`} value={project.link.github ?? ''} placeholder={detected ?? 'owner/name'} maxLength={140}
              valid={(text) => text === '' || REPO_SHAPE.test(text)} onKeep={(text) => { keep({ ...project.link, github: text === '' ? null : text }) }} />
          </Row>
          <GroupPick project={project} source="plane" keyed={keyed.plane} onSave={keep} />
          <GroupPick project={project} source="linear" keyed={keyed.linear} onSave={keep} />
        </>
      )}
      {note !== null && <p className="mx-scard-note" role="alert">{note}</p>}
    </>
  )
}

/** An open project not linked yet: listed under its resolved root unless that root is linked already (it is listed there). */
function OpenProject({ project, keyed, linkedRoots }: { project: TicketsProject; keyed: Readonly<Record<'plane' | 'linear', boolean>>; linkedRoots: ReadonlySet<string> }) {
  const links = useTicketLinks(project)
  const resolved = links.data?.project
  if (resolved === undefined || resolved === null || linkedRoots.has(rootKey(resolved))) return null
  return <ProjectEntry project={{ name: project.name, place: { machine: resolved.machine, folder: resolved.folder }, local: project.machine === LOCAL_MACHINE, link: NO_LINK }} keyed={keyed} linked={false} />
}

function rootKey(place: TicketPlace): string {
  return `${place.machine ?? ''}:${place.folder}`
}

/**
 * Settings › Tickets, in two parts. Accounts: GitHub's gh login and the Plane and Linear keys, each set once for every
 * project on this computer. Linked projects: which repo, Plane project and Linear team each project reads, kept by the
 * Maiker service per project (and so for every worktree of it), then the names you go by for Mine.
 */
export function TicketsSection({ projects, signIn }: { projects: readonly TicketsProject[]; signIn: GitHubSignIn | undefined }) {
  const keys = useKeys()
  const links = useTicketLinks(null)
  const { saveName } = useLinkChanges()
  const { note, settle } = useSaved()
  const keyed = { plane: keyStateOf(keys.data, 'Plane')?.set ?? false, linear: keyStateOf(keys.data, 'Linear')?.set ?? false }
  const linked: readonly LinkedProject[] = links.data?.projects ?? []
  const linkedRoots = new Set(linked.map(rootKey))
  const nameOf = (project: LinkedProject) => projects.find((open) => open.machineName === project.machine && open.folder === project.folder)?.name ?? folderName(project.folder)
  const me = links.data?.me ?? { plane: '', linear: '' }
  return (
    <>
      <Part title="Accounts" sub="Set up once on this computer, for every project." />
      <GitHubCard signIn={signIn} />
      {KEYED.map((each) => <KeyCard key={each.provider} {...each} />)}
      <Part title="Linked projects" sub="Which tickets each project shows. A project is its repository, so every worktree and every session in it shows the same tickets." />
      <Card title="Projects" foot="Kept by the Maiker service, so the desktop app and the terminal app show a project the same tickets. A GitHub repository needs no setup: the folder's origin is used.">
        {links.isPending ? <SkeletonLines label="Reading the linked projects" className="mx-scard-note" />
          : links.isError ? <p className="mx-scard-note" role="alert">{errorMessage(links.error, 'Could not read the linked projects')}</p>
            : (
              <>
                {linked.map((project) => (
                  <ProjectEntry key={rootKey(project)} project={{ name: nameOf(project), place: project, local: project.machine === null, link: project.link }} keyed={keyed} linked />
                ))}
                {projects.map((project) => <OpenProject key={project.linkKey} project={project} keyed={keyed} linkedRoots={linkedRoots} />)}
                {linked.length === 0 && projects.length === 0 && <p className="mx-scard-note">Open a chat in a project to set up its tickets, or open Tickets there.</p>}
              </>
            )}
      </Card>
      <Card title="You" foot="Mine shows the tickets assigned to you. GitHub knows you by your gh login.">
        {KEYED.map(({ provider, source }) => (
          <Row key={provider} label={`Your name in ${provider}`} detail="As it shows on tickets assigned to you.">
            <KeptField key={me[source]} label={`Your name in ${provider}`} value={me[source]} placeholder="Display name" maxLength={MOST_NAME_CHARS} valid={() => true} onKeep={(text) => { settle(saveName(provider, text), 'Could not save the name') }} />
          </Row>
        ))}
        {note !== null && <p className="mx-scard-note" role="alert">{note}</p>}
      </Card>
    </>
  )
}

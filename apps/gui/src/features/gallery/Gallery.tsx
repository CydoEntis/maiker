import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/card'
import { Fold } from '@/components/ui/fold'
import { Counter, Divider, Progress } from '@/components/ui/progress'
import { StatusIcon, type StatusMarkKind } from '@/components/ui/status-icon'
import { CodeChip, FileBadge, Tag, TextLink } from '@/components/ui/tag'
import { CORNERS, withLook, type Corners } from '@/features/workspace/theme/corners'
import { findTheme, themeStyle, THEMES } from '@/features/workspace/theme/themes'
import { Copy } from 'lucide-react'
import { ChatFeed, ChatParity, SubagentsBars, WaitingCards } from './ChatFeed'
import { RepliesGallery } from './RepliesGallery'
import { LiveTurnGallery } from './LiveTurnGallery'
import { DocumentsGallery } from './DocumentsGallery'
import { FlowPartsGallery } from './FlowPartsGallery'
import { galleryParams, galleryHash } from './galleryParams'

/*
 * Every shared primitive in every state, on any theme and either corner style, so the set can be checked against the
 * design's system page. Opened with `#gallery` (`#gallery?theme=Paper&corners=rounded`) in the desktop window or the
 * browser preview. The hover and pressed samples are drawn with the state's own look, as the system page draws them.
 */

const STATES: readonly StatusMarkKind[] = ['idle', 'done', 'needs', 'working']
const KINDS = ['primary', 'needs', 'soft', 'ghost', 'danger'] as const
/** What hover and press look like for each kind, drawn at rest so they can be compared side by side. */
const FORCED: Record<(typeof KINDS)[number], { hover: string; pressed: string }> = {
  primary: { hover: 'brightness-108', pressed: 'bg-[color-mix(in_oklab,var(--accent)_80%,var(--bg))]' },
  needs: { hover: 'brightness-108', pressed: 'bg-[color-mix(in_oklab,var(--needs)_80%,var(--bg))]' },
  soft: { hover: 'bg-[color-mix(in_oklab,var(--raise)_88%,var(--fg))]', pressed: 'bg-[color-mix(in_oklab,var(--raise)_80%,var(--bg))]' },
  ghost: { hover: 'bg-(--hover) text-(--fg)', pressed: 'bg-(--sel)' },
  danger: { hover: 'bg-[color-mix(in_oklab,var(--err)_18%,transparent)]', pressed: 'bg-[color-mix(in_oklab,var(--err)_24%,transparent)]' },
}
const FOCUS_RING = 'shadow-(--focus-underline)'

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-(family-name:--mono) text-[11px] font-medium text-(--dim)">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Captioned({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <span className="flex flex-col items-start gap-[5px]">
      {children}
      <span className="font-(family-name:--mono) text-[11px] font-medium text-(--dim)">{caption}</span>
    </span>
  )
}

function ButtonRow({ kind }: { kind: (typeof KINDS)[number] }) {
  const hint = kind === 'needs' || kind === 'soft' ? 'y' : undefined
  const label = kind === 'needs' ? 'Yes once' : 'Label'
  return (
    <Sample label={`Button/kind=${kind}`}>
      <div className="flex flex-wrap items-end gap-3.5">
        <Captioned caption="default"><Button variant={kind} keyHint={hint}>{label}</Button></Captioned>
        <Captioned caption="hover"><Button variant={kind} keyHint={hint} className={FORCED[kind].hover}>{label}</Button></Captioned>
        <Captioned caption="pressed"><Button variant={kind} keyHint={hint} className={FORCED[kind].pressed}>{label}</Button></Captioned>
        <Captioned caption="focus"><Button variant={kind} keyHint={hint} className={FOCUS_RING}>{label}</Button></Captioned>
        <Captioned caption="disabled"><Button variant={kind} keyHint={hint} disabled>{label}</Button></Captioned>
        <Captioned caption="size=sm"><Button variant={kind} size="sm">Label</Button></Captioned>
      </div>
    </Sample>
  )
}

function Primitives() {
  const [folded, setFolded] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
        <Sample label="Card · shell, head, body, foot">
          <Card>
            <CardHead><span>Head strip</span><span className="flex-1" /><IconButton label="Copy"><Copy /></IconButton></CardHead>
            <CardBody><span className="text-[13px] text-(--fg2)">Body. 10px 12px padding.</span></CardBody>
            <CardFoot><Button size="sm">Primary</Button><Button size="sm" variant="soft">Soft</Button></CardFoot>
          </Card>
        </Sample>
        <Sample label="Card · hover"><Card className="border-(--line2)"><CardHead>Edge goes to line2</CardHead></Card></Sample>
        <Sample label="Card · keyboard focus"><Card className={FOCUS_RING}><CardHead>2px focus underline inside</CardHead></Card></Sample>
        <Sample label="Card · tone=needs"><Card tone="needs"><CardHead><StatusIcon status="needs" />Amber edge</CardHead></Card></Sample>
        <Sample label="Card · tone=err"><Card tone="err"><CardHead>Error edge</CardHead></Card></Sample>
        <Sample label="Card · interactive (tab to it)"><Card interactive tabIndex={0}><CardHead>Hover or focus me</CardHead></Card></Sample>
      </div>
      {KINDS.map((kind) => <ButtonRow key={kind} kind={kind} />)}
      <Sample label="Button/kind=link"><Button variant="link">Open ticket</Button></Sample>
      <Sample label="IconButton">
        <div className="flex gap-3.5">
          <Captioned caption="default"><IconButton label="Copy"><Copy /></IconButton></Captioned>
          <Captioned caption="hover"><IconButton label="Copy" className="bg-(--hover) text-(--fg)"><Copy /></IconButton></Captioned>
          <Captioned caption="focus"><IconButton label="Copy" className={FOCUS_RING}><Copy /></IconButton></Captioned>
        </div>
      </Sample>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
        <Sample label="Tag">
          <Tag tone="done">Added</Tag><Tag>Modified</Tag><Tag tone="err">Deleted</Tag><Tag>MD</Tag>
          <Tag tone="err">exit 1</Tag><Tag tone="done">exit 0</Tag><Tag>round 2</Tag><Tag tone="err">Full access</Tag>
        </Sample>
        <Sample label="FileBadge">
          <FileBadge path="src/auth/session.ts" />
          <FileBadge path="README.md" />
          <FileBadge path="web/components/LoginForm.tsx" line={42} onOpen={() => undefined} />
          <FileBadge path="config/deploy.yaml" />
          <FileBadge path="db/migrations/0042_sessions.sql" />
          <FileBadge path=".env.local" />
          <span className="w-[180px]"><FileBadge path="packages/server/src/middleware/auth/requireSession.ts" /></span>
        </Sample>
        <Sample label="CodeChip · Link">
          <span className="text-sm text-(--fg2)">Run <CodeChip>pnpm test</CodeChip> or read <TextLink href="#gallery">the guide</TextLink></span>
        </Sample>
        <Sample label="StatusIcon (the four marks, one box)">
          {STATES.map((state) => <Captioned key={state} caption={state}><StatusIcon status={state} /></Captioned>)}
        </Sample>
        <Sample label="Fold">
          <div className="w-full border border-(--line)">
            <Fold open={folded} onToggle={() => { setFolded(!folded) }} more="Show 12 more lines" />
            <Fold open onToggle={() => undefined} more="Show 12 more lines" />
          </div>
        </Sample>
        <Sample label="Progress · Counter · Divider">
          <span className="w-[140px]"><Progress value={2} max={5} label="Progress" /></span>
          <Counter>2 of 5</Counter>
          <Divider />
        </Sample>
      </div>
    </div>
  )
}

const QUICK_THEMES = ['Maiker Day', 'Maiker Dark', 'Maiker Light', 'Abyss', 'Ember', 'Moss', 'Dusk', 'Paper', 'Tokyo Night']

function useHashParams() {
  const [params, setParams] = useState(() => galleryParams(window.location.hash))
  useEffect(() => {
    const read = () => { setParams(galleryParams(window.location.hash)) }
    window.addEventListener('hashchange', read)
    return () => { window.removeEventListener('hashchange', read) }
  }, [])
  return params
}

/** The gallery page: a theme and corner switcher over the primitives and the chat's cards. */
export function Gallery() {
  const { theme: themeName, corners } = useHashParams()
  const theme = withLook(findTheme(themeName))
  const style = themeStyle(theme)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.corners = corners
    for (const [name, value] of Object.entries(style)) if (name.startsWith('--')) root.style.setProperty(name, value)
    root.style.colorScheme = theme.light ? 'light' : 'dark'
  }, [corners, style, theme.light])
  return (
    <div className="mx-app" data-theme-kind={theme.light ? 'light' : 'dark'} style={{ ...style, position: 'static', minHeight: '100vh', overflow: 'auto', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui)' }}>
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-8 py-10">
        <header className="flex flex-col gap-3">
          <h1 className="m-0 text-[26px] font-[650] tracking-[-.015em]">Primitives</h1>
          <p className="m-0 text-sm text-(--muted)">Every shared component in every state. {theme.name}, {corners} corners.</p>
          <nav aria-label="Theme" className="flex flex-wrap gap-1.5">
            {QUICK_THEMES.filter((name) => THEMES.some((entry) => entry.name === name)).map((name) => (
              <Button key={name} asChild size="sm" variant={name === theme.name ? 'primary' : 'soft'}><a href={galleryHash(name, corners)}>{name}</a></Button>
            ))}
          </nav>
          <nav aria-label="Corners" className="flex gap-1.5">
            {CORNERS.map((option: Corners) => (
              <Button key={option} asChild size="sm" variant={option === corners ? 'primary' : 'soft'}><a href={galleryHash(theme.name, option)}>{option}</a></Button>
            ))}
          </nav>
        </header>
        <Primitives />
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Setup parts</h2>
        <FlowPartsGallery />
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Chat feed as the prototype draws it</h2>
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[780px] max-w-full" data-parity="wide"><ChatParity /></div>
          <div className="w-[360px] max-w-full" data-parity="narrow"><ChatParity /></div>
        </div>
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Chat feed</h2>
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[800px] max-w-full"><ChatFeed /></div>
          <div className="w-[400px] max-w-full"><ChatFeed /></div>
        </div>
        <h2 className="m-0 mt-4 text-[18px] font-[650]">A turn as it streams</h2>
        <div className="flex flex-wrap items-start gap-6">
          <LiveTurnGallery width={780} />
          <LiveTurnGallery width={360} />
        </div>
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Replies and quotes</h2>
        <div className="flex flex-wrap items-start gap-6">
          <RepliesGallery width={780} />
          <RepliesGallery width={360} />
        </div>
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Documents</h2>
        <DocumentsGallery />
        <h2 className="m-0 mt-4 text-[18px] font-[650]">The dock: helpers, queue, record</h2>
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[800px] max-w-full"><SubagentsBars /></div>
        </div>
        <h2 className="m-0 mt-4 text-[18px] font-[650]">Waiting cards</h2>
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[800px] max-w-full"><WaitingCards /></div>
          <div className="w-[400px] max-w-full"><WaitingCards /></div>
        </div>
      </div>
    </div>
  )
}


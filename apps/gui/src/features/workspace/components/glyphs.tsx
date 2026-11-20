import type { ReactNode } from 'react'
import { TreePine } from 'lucide-react'
import { StatusIcon } from '@/components/ui/status-icon'
import { SHELL_PROCESS } from '../model/session'
import { CODEX_MARK, DEEPSEEK_MARK, GEMINI_MARK, OPENCODE_MARK } from './agentMarks'
import { FOLDER_PATH } from './paths'

/** The one working spinner: a ring with a lit arc running round it, round or square with the corners (more can be added later). */
export function Spinner({ className = 'mx-spin' }: { className?: string; frozen?: boolean }) {
  return <StatusIcon status="working" size={SPINNER_PX} className={className} />
}

/** The one spinner's size beside text. */
const SPINNER_PX = 12

type SvgProps = { size: number; strokeWidth?: number; children: ReactNode; className?: string; fill?: string; stroke?: string }

function Svg({ size, strokeWidth = 2, children, className, fill = 'none', stroke = 'currentColor' }: SvgProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

type IconProps = { size?: number; strokeWidth?: number; stroke?: string }

const ICON_DRAWINGS = {
  collapse: () => <Svg size={15} strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16M15 10l-2 2 2 2" /></Svg>,
  expand: () => <Svg size={16} strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16M13 10l2 2-2 2" /></Svg>,
  plus: ({ size = 15 }: IconProps) => <Svg size={size}><path d="M12 5v14M5 12h14" /></Svg>,
  arrowUp: ({ size = 14, strokeWidth = 2 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>,
  arrowDown: ({ size = 14, strokeWidth = 2 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>,
  close: ({ size = 13, strokeWidth = 2 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  chevron: () => <Svg className="mx-chevron" size={12} strokeWidth={2.25} stroke="var(--dim)"><path d="m9 6 6 6-6 6" /></Svg>,
  chevronDown: ({ size = 11 }: IconProps) => <Svg size={size} strokeWidth={2.2} stroke="var(--dim)"><path d="m6 9 6 6 6-6" /></Svg>,
  folder: ({ size = 13 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={FOLDER_PATH} /></svg>
  ),
  gear: () => (
    <Svg size={13} strokeWidth={1.75}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.1z" /></Svg>
  ),
  chart: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>,
  list: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>,
  person: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0" /></Svg>,
  board: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M3 4h5v16H3zM9.5 4h5v11h-5zM16 4h5v7h-5z" /></Svg>,
  modules: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></Svg>,
  cycle: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" /></Svg>,
  milestone: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 21V4l13 4-13 5" /></Svg>,
  refresh: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></Svg>,
  splitRight: () => <Svg size={16} strokeWidth={1.6}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M12 4.5v15" /></Svg>,
  splitDown: () => <Svg size={16} strokeWidth={1.6}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 12h18" /></Svg>,
  panelLeft: () => <Svg size={15} strokeWidth={1.7}><rect x="3" y="4.5" width="18" height="15" rx="1" /><path d="M9 4.5v15" /></Svg>,
  panelBottom: () => <Svg size={15} strokeWidth={1.7}><rect x="3" y="4.5" width="18" height="15" rx="1" /><path d="M3 14.5h18" /></Svg>,
  panelRight: () => <Svg size={15} strokeWidth={1.7}><rect x="3" y="4.5" width="18" height="15" rx="1" /><path d="M15 4.5v15" /></Svg>,
  filter: () => <Svg size={15} strokeWidth={1.9}><path d="M4 6h16M7 12h10M10 18h4" /></Svg>,
  sidePanel: () => <Svg size={16} strokeWidth={1.6}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M14.5 4.5v15" /></Svg>,
  drawer: () => <Svg size={16} strokeWidth={1.6}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 14.5h18" /></Svg>,
  maximize: () => <Svg size={15} strokeWidth={1.8}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>,
  restore: () => <Svg size={15} strokeWidth={1.8}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>,
  /** A linked worktree: a tree, so it is not taken for the branch mark beside it. It takes the text's colour. */
  worktree: ({ size = 11, strokeWidth = 2.2 }: IconProps) => <TreePine size={size} strokeWidth={strokeWidth} aria-hidden="true" />,
  branch: ({ size = 11, strokeWidth = 2.2, stroke = 'var(--ansi-mag)' }: IconProps) => (
    <Svg size={size} strokeWidth={strokeWidth} stroke={stroke}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 4-6 3-10 5.5" /></Svg>
  ),
  broadcast: () => <Svg size={15} strokeWidth={1.8}><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" /></Svg>,
  grid: ({ size = 16 }: IconProps) => <Svg size={size} strokeWidth={1.8}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></Svg>,
  repo: ({ size = 16 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></Svg>,
  files: ({ size = 18 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" /></Svg>,
  changes: ({ size = 18 }: IconProps) => <Svg size={size} strokeWidth={1.8}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M8 9h8M12 7v4M8 16h8" /></Svg>,
  history: ({ size = 18 }: IconProps) => <Svg size={size} strokeWidth={1.8}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>,
  references: ({ size = 18 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" /></Svg>,
  laptop: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.7}><rect x="4.5" y="5" width="15" height="10.5" rx="1.8" /><path d="M2.5 19h19" /></Svg>,
  server: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.7}><rect x="3.5" y="4" width="17" height="6.5" rx="1.8" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8" /><path d="M7 7.25h.01M7 16.75h.01" /></Svg>,
  search: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>,
  pin: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></Svg>,
  pencil: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>,
  download: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" /></Svg>,
  palette: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></Svg>,
  layout: ({ size = 12 }: IconProps) => <Svg size={size} strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 10h18M10 10v10" /></Svg>,
  prompt: ({ size = 18, strokeWidth = 2 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth}><path d="m5 8 4 4-4 4M12 17h7" /></Svg>,
  check: ({ size = 9, stroke = 'var(--ok)', strokeWidth = 3.5 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth} stroke={stroke}><path d="M5 12.5 10 17 19 7" /></Svg>,
  chatPlus: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M8 12h8M12 8v8" /></Svg>,
  terminal: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="m5 8 4 4-4 4M12 17h7" /></Svg>,
  serverPlus: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.7}><rect x="3" y="4" width="14" height="6" rx="1.8" /><rect x="3" y="13.5" width="14" height="6" rx="1.8" /><path d="M6.5 7h.01M6.5 16.5h.01M20 7v6M17 10h6" /></Svg>,
  chat: ({ size = 13, strokeWidth = 1.8 }: IconProps) => <Svg size={size} strokeWidth={strokeWidth}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></Svg>,
  fleets: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M12 3v13M12 5l6 9H12M12 8l-5 6h5M4 18c2 2.5 5 3 8 1 3 2 6 1.5 8-1" /></Svg>,
  priority: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 7h16M4 12h11M4 17h6" /></Svg>,
  caret: () => <Svg className="mx-caret-icon" size={12} strokeWidth={2.5} stroke="currentColor"><path d="m9 6 6 6-6 6" /></Svg>,
  lock: ({ size = 10 }: IconProps) => <Svg size={size} strokeWidth={2}><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>,
  /** A tool step's own mark: a page read, a pencil for an edit, a prompt for a command run (layout 2h). */
  toolRead: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.7}><path d="M4 4h12l4 4v12H4zM8 12h8M8 16h5" /></Svg>,
  toolEdit: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.7}><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></Svg>,
  toolRun: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.7}><path d="M5 8l4 4-4 4M11 16h8" /></Svg>,
  /** The side panel beside a card it opens in. */
  openSide: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.7}><path d="M4 4h16v16H4zM14 4v16" /></Svg>,
  shield: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.8}><path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z" /></Svg>,
  bang: () => <Svg size={9} strokeWidth={3.5} stroke="var(--danger)"><path d="M12 6v7" /><path d="M12 18h.01" /></Svg>,
  /** The session header's Changes button: two branches meeting, the design's git mark. */
  gitChanges: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.8}><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 8.2v7.6M18 10.2c0 4-6 3.2-10.2 6.4" /></Svg>,
  /** The folder of a session in a worktree of its own: locked to it. */
  folderLocked: ({ size = 14 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5" /><rect x="14" y="17" width="8" height="5" rx="1" /><path d="M20 17v-2a2 2 0 1 0-4 0v2" /></Svg>,
  /** The plain folder of a hover card's folder line, in the design's own stroke. */
  folderPlain: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M3 6h6l2 2h10v11H3z" /></Svg>,
  /** The ⋯ button. */
  more: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.8} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></Svg>,
  /** A line count of changes, as the hover card's changes row draws it. */
  diffStat: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M12 4v7M8.5 7.5h7M8.5 17h7" /></Svg>,
  pullRequest: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M6 8v13M8 6a2 2 0 1 1-4 0a2 2 0 1 1 4 0M18 15v-6a3 3 0 0 0-3-3h-4M13 3.5 10.5 6 13 8.5M20 17a2 2 0 1 1-4 0a2 2 0 1 1 4 0" /></Svg>,
  /** The Chat | Terminal toggle's own marks, at the design's 13px. */
  chatBox: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" /></Svg>,
  terminalBox: ({ size = 13 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M4 5h16v14H4zM8 10l3 2.5L8 15M13 15h3" /></Svg>,
  restart: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.9}><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></Svg>,
  checks: ({ size = 15 }: IconProps) => <Svg size={size} strokeWidth={1.7}><path d="M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></Svg>,
} satisfies Record<string, (props: IconProps) => ReactNode>

export type IconName = keyof typeof ICON_DRAWINGS

/** The design's line icons, drawn at the sizes and stroke widths the prototype uses. */
export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  return ICON_DRAWINGS[name](props)
}

type IconKind = { kind: 'shell' | 'codex' | 'claude' | 'deepseek' | 'gemini' | 'opencode' | 'rust'; glyph: ReactNode }

const MARK_SIZE = '100%'

function Mark({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={MARK_SIZE} height={MARK_SIZE} fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true" focusable="false"><path d={d} /></svg>
  )
}

/** Claude Code's pixel crab on a 16 by 10 grid: body, two eye gaps, arms out to the sides, four legs. It takes the icon's colour. */
function ClaudeCrab() {
  return (
    <svg viewBox="0 0 16 10" width={MARK_SIZE} height={MARK_SIZE} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path d="M2 0h12v2H2zM2 2h2v2H2zM5 2h6v2H5zM12 2h2v2h-2zM0 4h16v2H0zM2 6h12v2H2zM3 8h1v2H3zM5 8h1v2H5zM10 8h1v2h-1zM12 8h1v2h-1z" />
    </svg>
  )
}

const ICONS: Record<string, IconKind> = {
  claude: { kind: 'claude', glyph: <ClaudeCrab /> },
  codex: { kind: 'codex', glyph: <Mark d={CODEX_MARK} /> },
  deepseek: { kind: 'deepseek', glyph: <Mark d={DEEPSEEK_MARK} /> },
  gemini: { kind: 'gemini', glyph: <Mark d={GEMINI_MARK} /> },
  opencode: { kind: 'opencode', glyph: <Mark d={OPENCODE_MARK} /> },
  cargo: { kind: 'rust', glyph: 'rs' },
  rustc: { kind: 'rust', glyph: 'rs' },
}
const SHELL_ICON: IconKind = { kind: 'shell', glyph: '>_' }

type IconSize = 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28 | 32

/**
 * An agent's or program's mark: the glyph alone, flat, with no tile or background behind it anywhere (the design's
 * rule 1: colour means status, plus Claude's orange). Claude's is orange, every other mark takes the text colour.
 */
export function AppIcon({ process, size, dimmed = false }: { process: string; size: IconSize; dimmed?: boolean }) {
  const program = process.split(/\s+/)[0] ?? ''
  const icon = ICONS[program] ?? (program === SHELL_PROCESS || program === '' ? SHELL_ICON : null)
  const className = `mx-app-icon size-${String(size)}${dimmed ? ' is-dimmed' : ''} is-flat`
  if (icon) return <span className={`${className} is-${icon.kind}`} aria-hidden="true">{icon.glyph}</span>
  // Any other agent or program: its first letter, flat.
  return <span className={`${className} is-tinted`} aria-hidden="true">{program.charAt(0).toUpperCase()}</span>
}

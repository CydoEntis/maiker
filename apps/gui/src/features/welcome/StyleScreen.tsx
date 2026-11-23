import type { Ref } from 'react'
import { Moon, Sun } from 'lucide-react'
import { ChoiceCards } from '@/components/ui/choice-cards'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { PaneView } from '@/features/workspace/model/chatView'
import { ThemeCarousel } from './ThemeCarousel'

/** A small window's title strip: three dots and what the window is, so each picture reads as a window at a glance. */
function PreviewBar({ name }: { name: string }) {
  return (
    <span className="mx-onb-preview-bar" aria-hidden="true">
      <i /><i /><i />
      <span>{name}</span>
    </span>
  )
}

/** A still picture of a terminal session: the agent's own CLI in a terminal window. Never animated, so reduced motion has nothing to stop. */
function TerminalPreview() {
  return (
    <span className="mx-onb-preview is-terminal">
      <PreviewBar name="claude — ~/chameleon" />
      <span className="mx-onb-preview-body font-(family-name:--mono) text-[11px] leading-[1.75] text-(--dim)">
        <span><span className="text-(--working)">~/chameleon</span> (main) $ claude</span>
        <span className="text-(--fg)"><span className="text-(--needs)">✳</span> Claude Code</span>
        <span className="mt-1 rounded-(--r-badge) px-1.5 py-[2px] text-(--fg2) shadow-[inset_0_0_0_1px_var(--line2)]">› fix the cart total<i className="ml-0.5 inline-block h-3 w-1.5 bg-(--fg2) align-[-2px]" /></span>
      </span>
    </span>
  )
}

/** A still picture of a chat session: what was asked as a bubble, the folded steps, a readable answer and the message box. */
function ChatPreview() {
  return (
    <span className="mx-onb-preview is-chat">
      <PreviewBar name="Fix the cart total" />
      <span className="mx-onb-preview-body gap-[6px] text-[11px] leading-normal text-(--muted)">
        <span className="self-end rounded-(--r-control) bg-(--accent) px-[9px] py-[2px] font-medium text-(--on-accent)">Fix the cart total</span>
        <span className="inline-flex items-center gap-1.5 text-(--dim)"><i className="inline-block size-1.5 rounded-full bg-(--ok)" />Read 5 files · 7 steps</span>
        <span><b className="font-medium text-(--fg)">An empty coupon gives NaN.</b> It now counts as no discount.</span>
        <span className="mx-onb-preview-box">Reply…</span>
      </span>
    </span>
  )
}

type Props = {
  headingId: string
  headingRef: Ref<HTMLHeadingElement>
  view: PaneView
  onView: (view: PaneView) => void
  /** The theme showing, by name. */
  theme: string
  onTheme: (name: string) => void
  /** Whether the theme showing is a light one; picking the other kind jumps to its default theme. */
  light: boolean
  onLight: (light: boolean) => void
  /** The themes of that kind, by name, which the carousel slides through. */
  names: readonly string[]
}

/** Screen 2: how sessions open, as two pictures to pick from, and the theme, as a carousel that recolours the app behind. */
export function StyleScreen({ headingId, headingRef, view, onView, theme, onTheme, light, onLight, names }: Props) {
  return (
    <>
      <h2 id={headingId} tabIndex={-1} ref={headingRef} className="mx-onb-title">Make it yours</h2>
      <p className="mx-onb-lead">Last thing. Both of these live in Settings › Appearance if you change your mind.</p>
      <div className="mx-onb-label">
        <span className="text-[13.5px] font-semibold text-(--fg)">Sessions open as</span>
        <span className="text-[12.5px] text-(--dim)">Chat is a clean conversation. Terminal is each agent’s own CLI.</span>
      </div>
      <ChoiceCards
        label="Sessions open as"
        value={view}
        onValueChange={(value) => { if (value === 'terminal' || value === 'chat') onView(value) }}
        cards={[
          { value: 'terminal', title: 'Terminal', preview: <TerminalPreview /> },
          { value: 'chat', title: 'Chat', recommended: true, preview: <ChatPreview /> },
        ]}
      />
      <div className="mx-onb-label is-row">
        <span className="flex flex-col gap-[3px]">
          <span id="mx-onb-theme" className="text-[13.5px] font-semibold text-(--fg)">Theme</span>
          <span className="text-[12.5px] text-(--dim)">Pick dark or light, then slide with ← →. The app behind follows.</span>
        </span>
        <Segmented aria-label="Dark or light themes" value={light ? 'light' : 'dark'} onValueChange={(kind) => { onLight(kind === 'light') }}>
          <SegmentedItem value="dark" icon={<Moon />}>Dark</SegmentedItem>
          <SegmentedItem value="light" icon={<Sun />}>Light</SegmentedItem>
        </Segmented>
      </div>
      <ThemeCarousel labelledBy="mx-onb-theme" value={theme} onPick={onTheme} names={names} />
    </>
  )
}

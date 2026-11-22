import type { Ref } from 'react'
import { ChoiceCards } from '@/components/ui/choice-cards'
import type { PaneView } from '@/features/workspace/model/chatView'
import { ThemeCarousel } from './ThemeCarousel'

/** A still picture of a terminal session: the agent's own CLI. Never animated, so reduced motion has nothing to stop. */
function TerminalPreview() {
  return (
    <span className="mx-onb-preview font-(family-name:--mono) text-[11px] leading-[1.8] text-(--dim)">
      <span><span className="text-(--working)">~/chameleon</span> (main) $ claude</span>
      <span className="text-(--fg)"><span className="text-(--needs)">✳</span> Claude Code</span>
      <span className="mt-1.5 border-y border-(--line) py-[3px] text-(--fg2)">› fix the cart total<i className="ml-0.5 inline-block h-3 w-1.5 bg-(--fg2) align-[-2px]" /></span>
    </span>
  )
}

/** A still picture of a chat session: what was asked, the folded steps, and a readable answer. */
function ChatPreview() {
  return (
    <span className="mx-onb-preview gap-[7px] text-[11px] leading-normal text-(--muted)">
      <span className="self-end rounded-(--r-control) bg-(--sel) px-[9px] py-[3px] text-(--fg)">Fix the cart total</span>
      <span className="text-(--dim)">Read 5 files · 7 steps</span>
      <span><b className="font-medium text-(--fg)">An empty coupon gives NaN.</b> It now counts as no discount.</span>
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
}

/** Screen 2: how sessions open, as two pictures to pick from, and the theme, as a carousel that recolours the app behind. */
export function StyleScreen({ headingId, headingRef, view, onView, theme, onTheme }: Props) {
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
      <div className="mx-onb-label">
        <span id="mx-onb-theme" className="text-[13.5px] font-semibold text-(--fg)">Theme</span>
        <span className="text-[12.5px] text-(--dim)">Slide through with ← →. The app behind this window changes as you go.</span>
      </div>
      <ThemeCarousel labelledBy="mx-onb-theme" value={theme} onPick={onTheme} />
    </>
  )
}

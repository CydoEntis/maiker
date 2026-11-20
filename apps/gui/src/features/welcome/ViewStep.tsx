import type { Ref } from 'react'
import { ChoiceCards } from '@/components/ui/choice-cards'
import type { PaneView } from '@/features/workspace/model/chatView'
import { StepHead } from './StepHead'
import { recommendationReason, viewName, viewNote, type StyleAnswers } from './setup'

const PREVIEW = 'flex h-[132px] flex-col gap-1 overflow-hidden bg-(--well) p-2.5 text-xs shadow-[inset_0_0_0_1px_var(--line)]'

/** A still picture of a terminal session: the agent's own CLI. Never animated, so reduced motion has nothing to stop. */
function TerminalPreview() {
  return (
    <span className={`${PREVIEW} font-(family-name:--mono) text-[11px] leading-relaxed`}>
      <span><b className="text-(--working)">~/chameleon</b> <i className="text-(--dim)">(main)</i> <span className="text-(--dim)">$</span> claude</span>
      <span><span className="text-(--needs)">✳</span> Claude Code</span>
      <span className="mt-1 border-y border-(--line) py-1"><span className="text-(--dim)">›</span> fix the cart total</span>
      <span className="text-(--needs)">▸▸ auto mode on</span>
    </span>
  )
}

/** A still picture of a chat session: folded steps, a readable answer, and an approval to click. */
function ChatPreview() {
  return (
    <span className={`${PREVIEW} leading-snug`}>
      <span className="self-end bg-(--sel) px-2 py-1">Fix the cart total</span>
      <span className="text-[11px] text-(--dim)">✓ Read 5 files · 7 steps</span>
      <span><b>An empty coupon gives NaN.</b> <span className="text-(--fg2)">It now counts as no discount.</span></span>
      <span className="mt-auto flex items-center justify-between border border-(--needs) px-2 py-1 text-(--needs)">
        <span>! Wants to run a command</span>
        <span className="bg-(--sel) px-1.5 font-semibold text-(--fg)">Yes once</span>
      </span>
    </span>
  )
}

type Props = {
  headingRef: Ref<HTMLHeadingElement>
  answers: StyleAnswers
  recommended: PaneView
  chosen: PaneView
  onChoose: (view: PaneView) => void
  geminiInstalled: boolean
}

/** Step 4: the view we suggest, from the person's own answers. Both are shown and either can be picked. */
export function ViewStep({ headingRef, answers, recommended, chosen, onChoose, geminiInstalled }: Props) {
  return (
    <>
      <StepHead headingRef={headingRef} title={`We’d start you in ${viewName(recommended)}`} lead={recommendationReason(answers)} />
      <ChoiceCards
        label="Open sessions in"
        value={chosen}
        onValueChange={(value) => { if (value === 'terminal' || value === 'chat') onChoose(value) }}
        cards={[
          { value: 'terminal', title: 'Terminal', detail: 'Each agent’s own CLI, exactly as it ships. Best if you live in the terminal.', recommended: recommended === 'terminal', preview: <TerminalPreview /> },
          { value: 'chat', title: 'Chat', detail: 'A clean conversation: folded steps, readable diffs, and approvals you click.', recommended: recommended === 'chat', preview: <ChatPreview /> },
        ]}
      />
      <p className="m-0 text-xs leading-normal text-(--fg2)">{viewNote(chosen, recommended, geminiInstalled)}</p>
    </>
  )
}

import type { ReactElement } from 'react'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import { AppIcon } from '@/features/workspace/components/glyphs'
import type { AgentUsage } from './agentLimits'
import { levelOf } from './meterFacts'
import { ContextRing } from './UsageMeter'

type Props = {
  usages: readonly AgentUsage[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page with the full history; the popover offers it at the end of its list. */
  onOpenAll?: (() => void) | undefined
  /** What the popover opens from: one element, which stays where it is. */
  children: ReactElement
}

/** Each agent's limits with when they start over. The list scrolls inside the popover; nothing in it sticks. */
export function UsagePopover({ usages, open, onOpenChange, onOpenAll, children }: Props) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <PopupContent side="top" align="end" collisionPadding={12} className="mx-usage-pop" aria-label="Usage limits">
        {usages.length === 0 && <p className="mx-usage-pop-empty">No agent has reported a limit yet.</p>}
        {usages.map((usage) => (
          <section key={usage.agent} className="mx-usage-pop-agent" aria-label={usage.name}>
            <h3 className="mx-usage-pop-head">
              <AppIcon process={usage.agent} size={14} />
              <span>{usage.name}</span>
              {usage.plan !== '' && <span className="mx-usage-pop-plan">{usage.plan}</span>}
            </h3>
            {usage.items.map((item) => {
              const level = levelOf(item.percent)
              return (
                <div key={item.key} className={`mx-usage-pop-row mx-usage-item is-${item.tone}${level === null ? '' : ` is-${level}`}`}>
                  <span className="mx-usage-pop-label">{item.label}</span>
                  <span className="mx-usage-pop-reset">{item.resetsIn === null ? '' : `resets in ${item.resetsIn}`}</span>
                  <ContextRing percent={item.percent} label={`${usage.name} ${item.label}`} />
                  <span className="mx-usage-figure">{`${String(item.percent)}%`}</span>
                </div>
              )
            })}
          </section>
        ))}
        {onOpenAll !== undefined && <button type="button" className="mx-usage-pop-all" onClick={onOpenAll}>Usage &amp; cost</button>}
      </PopupContent>
    </Popover.Root>
  )
}

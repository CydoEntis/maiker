import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import "./segmented.css"
import "./menu-row.css"

/** One choice out of several. Radix gives it the arrow keys, Tab as one stop, and the radio roles; what it looks like is the className. */
function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={className} {...props} />
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return <RadioGroupPrimitive.Item data-slot="radio-group-item" className={className} {...props} />
}

/**
 * The segmented control: a row of choices, one picked. It is the only one in the app, so every instance has the same
 * frame, room and picked look (components/ui/segmented.css); a caller decides only the choices and, with `full`, that
 * the row fills the width it is given.
 */
function Segmented({ className, full = false, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root> & { full?: boolean }) {
  return <RadioGroupPrimitive.Root data-slot="segmented" data-fold orientation="horizontal" className={cn("mx-segmented", full && "is-full", className)} {...props} />
}

type SegmentedItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  /** A mark before the word. Given alone (no children) the choice is the mark only and needs an `aria-label`. */
  icon?: React.ReactNode
  /** While not picked the choice shows its mark alone, so a row of several still fits; its `title` still names it. */
  compact?: boolean
}

function SegmentedItem({ className, icon, compact = false, children, ...props }: SegmentedItemProps) {
  const iconOnly = icon !== undefined && children === undefined
  return (
    <RadioGroupPrimitive.Item data-slot="segmented-item" data-compact={compact ? "" : undefined} data-icon-only={iconOnly ? "" : undefined} className={className} {...props}>
      {icon !== undefined && <span className="mx-seg-mark">{icon}</span>}
      {children !== undefined && <span className="mx-seg-word">{children}</span>}
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, Segmented, SegmentedItem }

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { RadioGroup, RadioGroupItem } from "./radio-group"
import { Tag } from "./tag"

type ChoiceCard = {
  value: string
  title: string
  /** One plain sentence under the title. */
  detail?: string
  /** Tags the card as the one we suggest. It does not pick it. */
  recommended?: boolean
  /** A picture of what the choice gives (a mini chat or terminal), drawn under the words. */
  preview?: ReactNode
}

const RECOMMENDED_WORD = "Recommended for you"

/**
 * A group of big selectable cards for a question with a few answers. It is a radio group: Tab lands on the picked card
 * (or the first), the arrows move and pick, and a screen reader hears "n of m" with the card's title and detail.
 * `value` is null until the person answers. `label` names the question for assistive tech.
 */
function ChoiceCards({ cards, value, onValueChange, label, className }: {
  cards: readonly ChoiceCard[]
  value: string | null
  onValueChange: (value: string) => void
  label: string
  className?: string
}) {
  return (
    <RadioGroup aria-label={label} value={value ?? ""} onValueChange={onValueChange} className={cn("grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]", className)}>
      {cards.map((card) => (
        <RadioGroupItem key={card.value} value={card.value} data-slot="choice-card" className="group flex cursor-pointer flex-col overflow-hidden rounded-(--r-panel) border border-(--line) bg-(--card) text-left text-(--fg) transition-[border-color] duration-(--t-fast) hover:border-(--line2) data-[state=checked]:border-(--fg)">
          <span className="flex items-start gap-2.5 p-3.5">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[14.5px] font-semibold">{card.title}</span>
              {card.detail !== undefined && <span className="text-[12.5px] leading-snug text-(--fg2)">{card.detail}</span>}
              {card.recommended === true && <Tag className="mt-1 self-start">{RECOMMENDED_WORD}</Tag>}
            </span>
            <span aria-hidden="true" className="mt-0.5 size-4 flex-none rounded-full shadow-[inset_0_0_0_1px_var(--line2)] group-data-[state=checked]:shadow-[inset_0_0_0_5px_var(--fg)]" />
          </span>
          {card.preview !== undefined && <span aria-hidden="true" className="mx-3.5 mb-3.5 block">{card.preview}</span>}
        </RadioGroupItem>
      ))}
    </RadioGroup>
  )
}

export { ChoiceCards, type ChoiceCard }

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { RadioGroup, RadioGroupItem } from "./radio-group"

type ChoiceCard = {
  value: string
  title: string
  /** One plain sentence under the title. */
  detail?: string
  /** Tags the card as the one we suggest. It does not pick it. */
  recommended?: boolean
  /** A picture of what the choice gives (a mini chat or terminal), drawn above the title. */
  preview?: ReactNode
}

const RECOMMENDED_WORD = "Recommended"
/** The one picked card: a ring in the text colour, as the design draws every picked card. */
const PICKED = "data-[state=checked]:bg-(--float-hover) data-[state=checked]:shadow-[inset_0_0_0_1.5px_var(--fg)]"
const TAG = "ml-auto rounded-(--r-control) bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-(--accent-text)"
const CARD = "group flex cursor-pointer flex-col gap-2 rounded-(--r-panel) p-2 text-left text-(--fg) shadow-[inset_0_0_0_1px_var(--float-line)] transition-[background-color,box-shadow] duration-(--t-fast) hover:bg-(--float-hover)"

/** A choice to pick: the picture of it when it has one, then a radio dot, its name, the tag when it is the one we suggest, and what it is for. */
function Card({ card }: { card: ChoiceCard }) {
  return (
    <RadioGroupItem value={card.value} data-slot="choice-card" className={cn(CARD, PICKED)}>
      {card.preview !== undefined && <span aria-hidden="true" className="block">{card.preview}</span>}
      <span className="flex flex-col gap-1 px-1 pb-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="size-3.5 flex-none rounded-full shadow-[inset_0_0_0_1.5px_var(--line2)] group-data-[state=checked]:shadow-[inset_0_0_0_4px_var(--fg)]" />
          {card.title}
          {card.recommended === true && <span className={TAG}>{RECOMMENDED_WORD}</span>}
        </span>
        {card.detail !== undefined && <span className="text-[12.5px] leading-normal text-(--dim)">{card.detail}</span>}
      </span>
    </RadioGroupItem>
  )
}

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
    <RadioGroup aria-label={label} value={value ?? ""} onValueChange={onValueChange} className={cn("grid auto-cols-fr grid-flow-col gap-3", className)}>
      {cards.map((card) => <Card key={card.value} card={card} />)}
    </RadioGroup>
  )
}

export { ChoiceCards, type ChoiceCard }

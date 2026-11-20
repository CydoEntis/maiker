import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { RadioGroup, RadioGroupItem } from "./radio-group"

type ChoiceCard = {
  value: string
  title: string
  /** One plain sentence under the title. */
  detail?: string
  /** A small mark above the title of an answer card (">_", "$"). */
  icon?: string
  /** Tags the card as the one we suggest. It does not pick it. */
  recommended?: boolean
  /** A picture of what the choice gives (a mini chat or terminal): the card is then a view card, the picture first and a radio dot by the title. */
  preview?: ReactNode
}

const RECOMMENDED_WORD = "Recommended for you"
/** The one picked card: the accent on a faint wash of it, as every choice in the setup. */
const PICKED = "data-[state=checked]:bg-[color-mix(in_oklab,var(--accent)_8%,transparent)] data-[state=checked]:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--accent)_80%,transparent)]"
const TAG = "ml-auto rounded-xl bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-(--accent-text)"
const CARD = "group cursor-pointer text-left text-(--fg) rounded-(--r-panel) bg-[color-mix(in_oklab,var(--fg)_2.5%,transparent)] shadow-[inset_0_0_0_1px_var(--line2)] transition-[background-color,box-shadow] duration-(--t-fast) hover:bg-[color-mix(in_oklab,var(--fg)_4.5%,transparent)]"

/** An answer to a question: its mark, its title, one line under it. */
function AnswerCard({ card }: { card: ChoiceCard }) {
  return (
    <RadioGroupItem value={card.value} data-slot="choice-card" className={cn(CARD, PICKED, "flex flex-col items-start gap-[3px] px-3 py-2.5")}>
      {card.icon !== undefined && <span aria-hidden="true" className="text-sm text-(--fg2)">{card.icon}</span>}
      <span className="flex w-full items-center text-[13px] font-semibold">{card.title}{card.recommended === true && <span className={TAG}>{RECOMMENDED_WORD}</span>}</span>
      {card.detail !== undefined && <span className="text-[11.5px] leading-[1.45] text-(--dim)">{card.detail}</span>}
    </RadioGroupItem>
  )
}

/** A view to pick: the picture of it, then a radio dot, its name, the tag when it is the one we suggest, and what it is for. */
function ViewCard({ card }: { card: ChoiceCard }) {
  return (
    <RadioGroupItem value={card.value} data-slot="choice-card" className={cn(CARD, PICKED, "flex flex-col gap-3 p-2.5")}>
      <span aria-hidden="true" className="block">{card.preview}</span>
      <span className="flex flex-col gap-1 px-1 pb-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="size-3.5 flex-none rounded-full shadow-[inset_0_0_0_1.5px_var(--line2)] group-data-[state=checked]:shadow-[inset_0_0_0_4px_var(--accent)]" />
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
  const views = cards.some((card) => card.preview !== undefined)
  return (
    <RadioGroup aria-label={label} value={value ?? ""} onValueChange={onValueChange} className={cn("grid auto-cols-fr grid-flow-col", views ? "gap-3" : "gap-2", className)}>
      {cards.map((card) => (views ? <ViewCard key={card.value} card={card} /> : <AnswerCard key={card.value} card={card} />))}
    </RadioGroup>
  )
}

export { ChoiceCards, type ChoiceCard }

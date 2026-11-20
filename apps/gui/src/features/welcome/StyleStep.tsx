import type { Ref } from 'react'
import { ChoiceCards } from '@/components/ui/choice-cards'
import { StepHead } from './StepHead'
import { STYLE_QUESTIONS, type StyleAnswers } from './setup'

/** Step 3: three questions, each answered by a card. They only decide the view we suggest next. */
export function StyleStep({ headingRef, answers, onAnswer }: { headingRef: Ref<HTMLHeadingElement>; answers: StyleAnswers; onAnswer: (question: string, value: string) => void }) {
  return (
    <>
      <StepHead headingRef={headingRef} title="How do you work?" lead="Three quick questions. Your answers decide how sessions open, and you can always change it." />
      {STYLE_QUESTIONS.map((question, index) => (
        <div key={question.id} className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <span aria-hidden="true" className="flex size-[18px] items-center justify-center rounded-(--r-badge) font-(family-name:--mono) text-[11px] text-(--fg2) shadow-[inset_0_0_0_1px_var(--line2)]">{index + 1}</span>
            {question.question}
          </span>
          <ChoiceCards
            label={question.question}
            value={answers[question.id] ?? null}
            onValueChange={(value) => { onAnswer(question.id, value) }}
            cards={question.options.map((option) => ({ value: option.value, title: option.title, detail: option.detail }))}
          />
        </div>
      ))}
    </>
  )
}

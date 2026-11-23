/**
 * The answer a letter pressed elsewhere in the chat is for: the row on that key in the card nearest the message box,
 * the card the chat gives the keys to. It is found by what the card shows, so a letter can only ever do what a row on
 * screen says it does. Null when no card offers the key, or while its card takes no answer.
 */
export function answerKeyTarget(chat: Element | null, key: string): HTMLButtonElement | null {
  if (!/^[a-z]$/i.test(key)) return null
  const lists = chat?.querySelectorAll<HTMLElement>('.mx-question-slot .mx-answers')
  const nearest = lists?.[lists.length - 1]
  return nearest?.querySelector<HTMLButtonElement>(`button[data-answer-key="${key.toLowerCase()}"]:not(:disabled)`) ?? null
}

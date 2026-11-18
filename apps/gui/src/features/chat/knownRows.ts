import { createContext } from 'react'

/**
 * The rows the chat has already shown: those its history held when it loaded, and each reply since, once it
 * is on screen. A reply that is not among them arrived while the person watched and is typed in from its first
 * word; one that is shows whole, so a row the list drew again (scrolled back to) is never typed a second time.
 */
export const KnownRowsContext = createContext<Set<string> | null>(null)

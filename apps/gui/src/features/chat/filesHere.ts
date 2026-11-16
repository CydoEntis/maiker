import { createContext } from 'react'

/**
 * Whether the chat's files are kept on this computer. A chat on another machine names files kept there, which this
 * computer's host cannot look at, so they are never called gone.
 */
export const FilesHereContext = createContext(true)

/**
 * The pane width, in px, below which the header gives up the Chat · Terminal tabs. What is gone stays in the ⋯ menu;
 * the title always keeps its room.
 */
export const SWITCHER_MIN_PX = 360

export type HeaderFit = { switcher: boolean }

/** What the header shows at a pane width; everything while the width is not measured yet. */
export function headerFit(width: number | null): HeaderFit {
  return { switcher: width === null || width >= SWITCHER_MIN_PX }
}

/** The shell a plain terminal runs, as its header says it (`zsh`): the program's own name, else "shell". */
export function shellProgram(session: { conversation: { process?: string | undefined } }): string {
  const name = (session.conversation.process ?? '').trim().split(/[\\/]/).at(-1)?.replace(/\.exe$/i, '').replace(/^-/, '') ?? ''
  return name === '' ? 'shell' : name
}

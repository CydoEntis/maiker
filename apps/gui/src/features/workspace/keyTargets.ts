/**
 * What the go-to keys look for on screen. The chat box, the model picker and the sidebar's rows are drawn deep inside
 * their own features, and which of them is in front (a filter, a fold, the pane with the focus) is known only there,
 * so the keys read the window as it is drawn instead of a second copy of that state.
 */

/** Marks a sidebar row with its session's id, so the session keys follow the rows in the order they are drawn. */
export const SESSION_ROW_ATTRIBUTE = 'data-session-id'

const CHAT_BOX = 'textarea.mx-box-text:not(:disabled)'
const MODEL_PICKER = 'button.mx-model-button'
const PANE = '.mx-pane'
const SIDEBAR = '.mx-sidebar'
/** A tab kept mounted behind the one in front, or a page under a dialog, is not on screen. */
const OFF_SCREEN = '[inert], [hidden], [aria-hidden="true"]'

function onScreen(root: ParentNode, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => element.closest(OFF_SCREEN) === null)
}

/** The one `selector` names in the pane that has the keyboard, else in the focused pane, else the first on screen. */
function inFront(root: HTMLElement, selector: string): HTMLElement | null {
  const active = document.activeElement?.closest<HTMLElement>(PANE) ?? null
  const scopes = [active, root.querySelector<HTMLElement>(`${PANE}.is-focused`), root]
  for (const scope of scopes) {
    const [found] = scope === null ? [] : onScreen(scope, selector)
    if (found !== undefined) return found
  }
  return null
}

/** Puts the keyboard in the chat box in front, with the caret at the end; false when no chat box is on screen. */
export function focusChatBox(root: HTMLElement | null): boolean {
  const field = root === null ? null : inFront(root, CHAT_BOX)
  if (!(field instanceof HTMLTextAreaElement)) return false
  field.focus({ preventScroll: true })
  field.setSelectionRange(field.value.length, field.value.length)
  return true
}

/** Opens the agent and model picker of the chat box in front; false when there is none. */
export function openModelPicker(root: HTMLElement | null): boolean {
  const button = root === null ? null : inFront(root, MODEL_PICKER)
  if (button === null) return false
  button.focus({ preventScroll: true })
  button.click()
  return true
}

/** Puts the keyboard on the sidebar's row of the session in front, else its first row; false when the sidebar is not drawn. */
export function focusSidebar(root: HTMLElement | null): boolean {
  const [sidebar] = root === null ? [] : onScreen(root, SIDEBAR)
  if (sidebar === undefined) return false
  const row = sidebar.querySelector<HTMLElement>(`button[${SESSION_ROW_ATTRIBUTE}][aria-current="page"]`) ?? sidebar.querySelector<HTMLElement>(`button[${SESSION_ROW_ATTRIBUTE}]`) ?? sidebar.querySelector<HTMLElement>('button:not(:disabled)')
  row?.focus()
  return row !== null
}

/** The sessions in the order the sidebar draws their rows, or null when it draws none (hidden, or Focus mode). */
export function sidebarRowOrder(root: HTMLElement | null): string[] | null {
  const ids = root === null ? [] : onScreen(root, `${SIDEBAR} [${SESSION_ROW_ATTRIBUTE}]`).map((row) => row.getAttribute(SESSION_ROW_ATTRIBUTE) ?? '')
  return ids.length === 0 ? null : ids
}

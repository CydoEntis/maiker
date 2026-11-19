/** A name git takes for a new branch. */
export const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** What git refuses in a ref name besides a space: `..`, `~ ^ : ? * [ \`, a slash at either end, and `.lock` at the end. */
const REFUSED_BY_GIT = /\.\.|[~^:?*[\\]|\/$|^\/|\.lock$/

/**
 * Why a typed branch name cannot be made, in the words the branch list shows under the search box; null when the name
 * is fine or nothing is typed. A name with spaces is offered back with dashes, as the likeliest thing meant.
 */
export function branchNameError(typed: string): string | null {
  const name = typed.trim()
  if (name === '') return null
  if (/\s/.test(name)) return `Branch names can't have spaces. Try ${name.replace(/\s+/g, '-')}.`
  if (REFUSED_BY_GIT.test(name) || !BRANCH_NAME.test(name)) return "That isn't a valid branch name."
  return null
}

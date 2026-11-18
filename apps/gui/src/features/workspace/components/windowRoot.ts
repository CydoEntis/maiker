/** The themed window root, where a dialog mounts so it reads the theme's tokens and the corners' material (null outside the window, where the body serves). */
export const windowRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('.mx-app')

import type { UsageItem } from '@/features/chat/usageStrip'

/** Where a graded meter turns to the needs colour, then the danger colour. */
const WARN_FROM = 70
const HOT_FROM = 90

/** How close to its limit a meter is: the needs colour from 70%, the danger colour from 90%. */
export const levelOf = (percent: number): 'warn' | 'hot' | null => (percent >= HOT_FROM ? 'hot' : percent >= WARN_FROM ? 'warn' : null)

/** The short name a meter wears beside its figure. */
export const usageName = (item: { window: string | null }): string => (item.window === null ? 'Context' : item.window === 'week' ? 'Week' : item.window)

/** What a meter says on hover and to a screen reader. */
export function meterTip(item: UsageItem): string {
  if (item.window === null) return `How much of this chat's memory is used: ${String(item.percent)}%`
  return item.resetsIn === null ? `${item.label}: ${String(item.percent)}% used` : `${item.label}: ${String(item.percent)}% used · resets in ${item.resetsIn}`
}

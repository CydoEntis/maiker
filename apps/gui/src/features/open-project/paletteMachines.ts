import { LOCAL_MACHINE } from '@/api/machines'
import type { MachineHead } from '@/features/workspace/model/machines'
import type { Platform } from '@/features/workspace/model/shortcuts'
import { HOME_FOLDER, type MachineOs, type PaletteMachine } from './openPalette'

/**
 * The machines the palette offers: every machine the window knows, this computer and the others. Browsing starts in
 * `localStart` (the projects folder) on this computer and at home on another machine; one whose line is not up is
 * listed with the host's reason.
 */
export function paletteMachinesOf(heads: readonly MachineHead[], localStart: string): PaletteMachine[] {
  return heads.map((head) => {
    const local = head.machine === LOCAL_MACHINE
    return {
      machine: head.machine,
      name: head.name,
      label: head.label,
      address: local ? null : head.target,
      ready: local || head.chip?.tone === 'ok',
      why: local ? null : head.why ?? head.chip?.word ?? null,
      start: local && localStart !== '' ? localStart : HOME_FOLDER,
    }
  })
}

/** The system this window runs on, as the palette's path rules name it. */
export function osOfPlatform(platform: Platform): MachineOs {
  return platform === 'mac' ? 'macos' : platform
}

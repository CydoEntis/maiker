import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu } from '@/features/workspace/components/NewChatMenus'
import { PlaceHead } from './PlaceHead'
import type { MachinePicking } from './picking'

const WIDTH = 300

/** The first chip of a draft's row: the computer the session runs on. It says its name only for another machine, as a started session's row does. */
export function MachineChip({ machine }: { machine: MachinePicking }) {
  const name = machine.down === null ? machine.label : `${machine.label}, not reachable`
  return (
    <ChipMenu
      title="Machine"
      summary={name}
      chevron={false}
      triggerClass={`mx-place-chip is-machine${machine.down === null ? '' : ' is-down'}`}
      width={WIDTH}
      icon={<span className="mx-place-icon"><Icon name={machine.remote ? 'server' : 'laptop'} size={13} /></span>}
      label={machine.remote ? <span className="mx-place-text">{machine.label}</span> : null}
      header={<PlaceHead main={machine.label} sub={machine.down ?? 'The session runs here'} />}
      sections={machine.sections}
      footer={machine.footer}
    />
  )
}

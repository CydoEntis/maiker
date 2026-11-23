import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu } from '@/features/workspace/components/NewChatMenus'
import { PlaceHead } from './PlaceHead'
import type { MachinePicking } from './picking'

const WIDTH = 300

/** The first chip of a draft's row: the computer the session runs on. It says its name only for another machine, as a started session's row does. */
/** `hero`: the large chip over an empty draft, which names this computer too and opens downward. */
export function MachineChip({ machine, hero = false }: { machine: MachinePicking; hero?: boolean }) {
  const name = machine.down === null ? machine.label : `${machine.label}, not reachable`
  return (
    <ChipMenu
      title={hero ? 'Runs on' : 'Machine'}
      summary={name}
      chevron={hero}
      side={hero ? 'bottom' : 'top'}
      triggerClass={`mx-place-chip is-machine${machine.down === null ? '' : ' is-down'}${hero ? ' is-hero' : ''}`}
      width={WIDTH}
      icon={<span className="mx-place-icon"><Icon name={machine.remote ? 'server' : 'laptop'} size={13} /></span>}
      label={machine.remote || hero ? <span className="mx-place-text">{machine.remote ? machine.label : 'This computer'}</span> : null}
      header={<PlaceHead main={machine.label} sub={machine.down ?? 'The session runs here'} />}
      sections={machine.sections}
      footer={machine.footer}
    />
  )
}

import { Keyboard } from 'lucide-react'
import { CustomShortcuts, ResetDefaultShortcuts } from '../CustomShortcuts'
import { SettingsCard } from '../components'

export function ShortcutsSection() {
  return (
    <SettingsCard
      Icon={Keyboard}
      title="快捷键"
      extra={
        <>
          <div className="text-sm font-light ml-2 mt-1">
            只有在主界面时快捷键才有效，设置页里只有部分快捷键生效。点击按键可修改
          </div>
          <ResetDefaultShortcuts />
        </>
      }
    >
      <CustomShortcuts />
    </SettingsCard>
  )
}

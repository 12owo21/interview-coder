import { useState, type ReactNode } from 'react'
import { ChevronRight, Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** One titled block of settings */
export function SettingsCard({
  Icon,
  title,
  extra,
  children
}: {
  Icon: LucideIcon
  title: string
  /** Rendered after the title, e.g. a save indicator or a reset button */
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-gray-300/80 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center">
        <Icon className="h-5 w-5 mr-2" />
        {title}
        {extra}
      </h2>
      {children}
    </div>
  )
}

/**
 * A label with its note on the left, the control on the right. The label is a
 * plain block, not a <label>: a note may hold a button, which a <label> would
 * treat as its control and press on any click on the text.
 */
export function Field({
  label,
  note,
  children,
  className
}: {
  label: ReactNode
  note?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="text-sm font-medium">
        {label}
        {note && <span className="ml-2 text-xs font-light">{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** Settings few people touch, folded away until asked for */
export function Advanced({
  children,
  defaultOpen = false
}: {
  children: ReactNode
  /** Start unfolded, e.g. when one of them is already set */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        高级
      </button>
      {open && <div className="mt-3 space-y-4 pl-4 border-l-2 border-gray-400/70">{children}</div>}
    </div>
  )
}

/** A key field whose text is hidden until the eye is clicked */
export function SecretInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex items-center w-60 shrink-0">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-l-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={placeholder}
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setVisible(!visible)}
        className="border border-l-0 rounded-l-none rounded-r-md h-9 w-9 hover:border-none"
      >
        {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </Button>
    </div>
  )
}

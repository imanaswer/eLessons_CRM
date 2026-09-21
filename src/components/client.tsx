'use client'
import { useEffect, useRef } from 'react'

// Timestamps are stored in UTC and shown in the viewer's timezone (PRD s13).
export function LocalTime({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const d = new Date(iso)
  return <time dateTime={iso} suppressHydrationWarning>{dateOnly ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time>
}

export function SelectAll({ name }: { name: string }) {
  return <input type="checkbox" aria-label="Select all on this page" onChange={(e) => {
    e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((c) => { c.checked = e.currentTarget.checked })
  }} />
}

// Esc closes the drawer; focus moves into it on open (keyboard users).
export function DrawerKeys({ closeHref }: { closeHref: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    ref.current?.parentElement?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') window.location.assign(closeHref) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeHref])
  return <span ref={ref} hidden />
}

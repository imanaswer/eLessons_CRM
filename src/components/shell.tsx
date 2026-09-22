'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { I } from './icons.tsx'
import type { NAV } from '@/app/(app)/nav.ts'

type Item = (typeof NAV)[number]
export function SideNav({ items }: { items: Item[] }) {
  const path = usePathname()
  const isCurrent = (href: string) => href === '/' ? path === '/' : path === href || (path.startsWith(href + '/') && href !== '/leads') || (href === '/leads' && path === '/leads')
  const groups: [Item['group'], string][] = [['main', ''], ['secondary', 'Workspace'], ['admin', 'Admin']]
  return <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:block lg:space-y-4 lg:px-3 lg:pb-6">
    {groups.map(([g, title]) => { const list = items.filter((n) => n.group === g); if (!list.length) return null
      return <div key={g} className="contents lg:block">{title && <p className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-faint lg:block">{title}</p>}
        <div className="contents lg:block lg:space-y-0.5">{list.map((n) => { const Icon = I[n.icon]; return <Link key={n.href} href={n.href} aria-current={isCurrent(n.href) ? 'page' : undefined} className="nav-item"><Icon /><span className="whitespace-nowrap">{n.label}</span></Link> })}</div></div> })}
  </nav>
}

// ⌘K: search leads by name or phone, or jump to a screen. No animation on open: it is a keyboard action used constantly.
export function CommandPalette({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [i, setI] = useState(0)
  const router = useRouter(), ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQ(''); setI(0) } if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  const nav = items.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).slice(0, 6)
  const searchable = q.trim().length >= 2
  const options = [...(searchable ? [{ label: `Search leads for “${q.trim()}”`, href: `/leads?view=all&q=${encodeURIComponent(q.trim())}`, kind: 'search' as const }] : []), ...nav.map((n) => ({ label: n.label, href: n.href, kind: 'nav' as const }))]
  const go = (href: string) => { setOpen(false); router.push(href) }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="btn btn-quiet hidden h-8 gap-2 pr-2 text-muted sm:inline-flex" aria-label="Search (⌘K)"><I.search className="h-4 w-4" /><span className="w-36 text-left text-[12.5px]">Search leads, go to…</span><kbd className="rounded border border-line bg-sunken px-1.5 font-mono text-[10.5px] text-faint">⌘K</kbd></button>
  return <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
    <div className="float w-full max-w-lg overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-line px-3"><I.search className="h-4 w-4 text-faint" /><input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, options.length - 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)) } if (e.key === 'Enter' && options[i]) go(options[i]!.href) }} className="h-11 w-full bg-transparent text-[14px] outline-none placeholder:text-faint" placeholder="Type a name, phone number or screen…" /></div>
      <ul className="max-h-80 overflow-y-auto p-1.5">{options.map((o, k) => <li key={o.href + k}><button type="button" onMouseEnter={() => setI(k)} onClick={() => go(o.href)} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] ${k === i ? 'bg-brand-soft text-brand' : 'text-ink-2'}`}>{o.kind === 'search' ? <I.leads className="h-4 w-4" /> : <I.chevron className="h-4 w-4 text-faint" />}{o.label}</button></li>)}
        {options.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches.</li>}</ul>
      <div className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-faint"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
    </div></div>
}

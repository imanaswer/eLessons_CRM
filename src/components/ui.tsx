import Link from 'next/link'
import { I } from './icons.tsx'
// Shared primitives. Every screen uses these so the vocabulary stays identical across the product.
export function Page({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[22px] font-semibold leading-tight text-ink">{title}</h1>{sub && <p className="mt-1 max-w-[70ch] text-[13px] text-muted">{sub}</p>}</div>{action && <div className="flex flex-wrap items-center gap-2">{action}</div>}</header>{children}</div>
}
export function Table({ head, children, empty, emptyHint }: { head: string[]; children: React.ReactNode; empty?: string; emptyHint?: string }) {
  return <section className="panel overflow-hidden"><div className="overflow-x-auto"><table className="w-full"><thead><tr>{head.map((h, i) => <th key={i} className={`th ${h.startsWith('#') ? 'text-right' : ''}`}>{h.replace(/^#/, '')}</th>)}</tr></thead>
    <tbody className="divide-y divide-line">{children}{empty && <tr><td colSpan={head.length}><Empty title={empty} hint={emptyHint} /></td></tr>}</tbody></table></div></section>
}
export function Empty({ title, hint, action, icon = 'inbox' }: { title: string; hint?: string; action?: React.ReactNode; icon?: keyof typeof I }) {
  const Icon = I[icon]
  return <div className="flex flex-col items-center px-6 py-14 text-center"><span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-faint"><Icon className="h-5 w-5" /></span><p className="text-[14px] font-medium text-ink">{title}</p>{hint && <p className="mt-1 max-w-[46ch] text-[13px] text-muted">{hint}</p>}{action && <div className="mt-4">{action}</div>}</div>
}
export const Chip = ({ tone = '', dot, children }: { tone?: string; dot?: boolean; children: React.ReactNode }) => <span className={`chip ${dot ? 'chip-dot' : ''} ${tone}`}>{children}</span>
export const STATE_TONE: Record<string, string> = { Healthy: 'text-ok', 'No events yet': 'text-muted', Configured: 'text-muted', 'Mapping pending': 'text-warn', Stale: 'text-warn', 'Action needed': 'text-warn', Reconnect: 'text-danger', 'Not connected': 'text-muted' }
export const LIFECYCLE_TONE: Record<string, string> = { ENQUIRY: 'text-brand', PROSPECT: 'text-warn', INTERESTED: 'text-ok', DEAD: 'text-muted', ENROLLED: 'text-ok' }
export const Lifecycle = ({ state, label }: { state: string; label?: string }) => <span className={`chip chip-dot ${LIFECYCLE_TONE[state] ?? ''}`}>{label ?? state[0] + state.slice(1).toLowerCase()}</span>
// RP-7 drill-down: every number links to the lead list behind it
export function Stat({ label, value, href, tone, hint }: { label: string; value: string | number; href?: string; tone?: string; hint?: string }) {
  const body = <><dt className="text-[12px] font-medium text-muted">{label}</dt><dd className={`num mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em] ${tone ?? 'text-ink'}`}>{value}</dd>{hint && <p className="mt-1.5 text-[11.5px] text-faint">{hint}</p>}</>
  return href ? <Link href={href} className="group block px-4 py-3.5 transition-colors hover:bg-sunken">{body}</Link> : <div className="px-4 py-3.5">{body}</div>
}
export function Seg({ items, current, hrefFor }: { items: [string, string][]; current: string; hrefFor: (k: string) => string }) {
  return <nav className="-mx-1 flex gap-0.5 overflow-x-auto px-1 py-0.5">{items.map(([k, l]) => <Link key={k} href={hrefFor(k)} aria-current={current === k ? 'page' : undefined} className="seg">{l}</Link>)}</nav>
}
// deterministic hue from a name: the same parent always gets the same colour
const HUES = ['#3557d6', '#1f7a4d', '#a35d0a', '#7c3aed', '#0e7490', '#b8362f', '#4d7c0f', '#9d174d']
export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const n = (name ?? '?').trim(), init = n.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('') || '?'
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const color = HUES[h % HUES.length]!, dim = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8', lg: 'h-11 w-11 text-[14px]' }[size]
  return <span className={`avatar ${dim}`} style={{ background: color + '1a', color }} aria-hidden="true">{init}</span>
}
export const money = (n: number | string | null | undefined, cur = 'INR') => n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n))
export const fmtPhone = (p: string | null | undefined) => p ? p.replace(/^(\+\d{2})(\d{5})(\d+)$/, '$1 $2 $3') : ''

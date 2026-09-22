import Link from 'next/link'
// Small shared pieces for the Phase 2-6 screens.
export function Page({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="text-sm text-muted">{sub}</p>}</div>{action}</div>{children}</div>
}
export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  return <section className="panel overflow-x-auto"><table className="w-full"><thead className="border-b border-line"><tr>{head.map((h, i) => <th key={i} className={`th ${h.startsWith('#') ? 'text-right' : ''}`}>{h.replace(/^#/, '')}</th>)}</tr></thead>
    <tbody className="divide-y divide-line">{children}{empty && <tr><td className="td text-muted" colSpan={head.length}>{empty}</td></tr>}</tbody></table></section>
}
export const Chip = ({ tone = '', children }: { tone?: string; children: React.ReactNode }) => <span className={`chip ${tone}`}>{children}</span>
export const STATE_TONE: Record<string, string> = { Healthy: 'text-ok', 'No events yet': 'text-muted', Configured: 'text-muted', 'Mapping pending': 'text-warn', Stale: 'text-warn', 'Action needed': 'text-warn', Reconnect: 'text-danger', 'Not connected': 'text-muted' }
// RP-7 drill-down: every number is a link to the lead list behind it
export function Stat({ label, value, href, tone }: { label: string; value: string | number; href?: string; tone?: string }) {
  const body = <><dt className="text-xs text-muted">{label}</dt><dd className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd></>
  return href ? <Link href={href} className="block px-4 py-3 hover:bg-canvas">{body}</Link> : <div className="px-4 py-3">{body}</div>
}
export const money = (n: number | string | null | undefined, cur = 'INR') => n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n))
